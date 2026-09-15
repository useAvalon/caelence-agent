use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use hound::{WavSpec, WavWriter};
use serde::Serialize;

#[derive(Default)]
pub struct MicState {
    active: Mutex<Option<ActiveMic>>,
}

struct ActiveMic {
    stop: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f32>>>,
    spec: (u32, u16),
    join: JoinHandle<()>,
}

#[derive(Serialize)]
pub struct MicClip {
    pub data: String,
    pub format: String,
}

impl MicState {
    fn start(&self) -> Result<(), String> {
        let mut slot = self.active.lock().map_err(|_| "Could not start the microphone.")?;
        if slot.is_some() {
            return Err("Dictation is already running.".into());
        }

        let stop = Arc::new(AtomicBool::new(false));
        let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();
        let stop_thread = Arc::clone(&stop);
        let samples_thread = Arc::clone(&samples);

        let join = thread::spawn(move || {
            let started = start_stream(samples_thread, &ready_tx);
            if started.is_err() {
                return;
            }
            let stream = match started {
                Ok(stream) => stream,
                Err(()) => return,
            };
            while !stop_thread.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(40));
            }
            drop(stream);
        });

        let spec = ready_rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Could not start the microphone.".to_string())
            .and_then(|result| result)?;
        *slot = Some(ActiveMic {
            stop,
            samples,
            spec,
            join,
        });
        Ok(())
    }

    fn stop(&self) -> Result<MicClip, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Could not stop the microphone.")?
            .take()
            .ok_or("No recording is in progress.")?;
        active.stop.store(true, Ordering::SeqCst);
        let _ = active.join.join();
        let samples = active
            .samples
            .lock()
            .map_err(|_| "Could not stop the microphone.")?
            .clone();
        if samples.is_empty() {
            return Err("Recording was empty.".into());
        }
        let wav = pcm_to_wav(&samples, active.spec.0, active.spec.1)?;
        Ok(MicClip {
            data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, wav),
            format: "wav".into(),
        })
    }
}

#[tauri::command]
pub fn mic_start(state: tauri::State<MicState>) -> Result<(), String> {
    state.start()
}

#[tauri::command]
pub fn mic_stop(state: tauri::State<MicState>) -> Result<MicClip, String> {
    state.stop()
}

fn start_stream(
    samples: Arc<Mutex<Vec<f32>>>,
    ready: &mpsc::Sender<Result<(u32, u16), String>>,
) -> Result<cpal::Stream, ()> {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(device) => device,
        None => {
            let _ = ready.send(Err("No microphone is available.".into()));
            return Err(());
        }
    };
    let config = match device.default_input_config() {
        Ok(config) => config,
        Err(err) => {
            let _ = ready.send(Err(format!("Could not start the microphone: {err}")));
            return Err(());
        }
    };
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let stream_config = config.config();
    let built = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            {
                let samples = Arc::clone(&samples);
                move |data: &[f32], _| append_f32(&samples, data)
            },
            mic_err,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            {
                let samples = Arc::clone(&samples);
                move |data: &[i16], _| {
                    if let Ok(mut buf) = samples.lock() {
                        buf.extend(data.iter().map(|s| *s as f32 / 32768.0));
                    }
                }
            },
            mic_err,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            {
                let samples = Arc::clone(&samples);
                move |data: &[u16], _| {
                    if let Ok(mut buf) = samples.lock() {
                        buf.extend(data.iter().map(|s| (*s as f32 / 32768.0) - 1.0));
                    }
                }
            },
            mic_err,
            None,
        ),
        other => {
            let _ = ready.send(Err(format!("Microphone format {other:?} is not supported.")));
            return Err(());
        }
    };
    let stream = match built {
        Ok(stream) => stream,
        Err(err) => {
            let _ = ready.send(Err(format!("Could not start the microphone: {err}")));
            return Err(());
        }
    };
    if let Err(err) = stream.play() {
        let _ = ready.send(Err(format!("Could not start the microphone: {err}")));
        return Err(());
    }
    let _ = ready.send(Ok((sample_rate, channels)));
    Ok(stream)
}

fn mic_err(err: cpal::StreamError) {
    eprintln!("microphone: {err}");
}

fn append_f32(samples: &Arc<Mutex<Vec<f32>>>, data: &[f32]) {
    if let Ok(mut buf) = samples.lock() {
        buf.extend_from_slice(data);
    }
}

fn pcm_to_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            WavWriter::new(&mut cursor, spec).map_err(|err| format!("Could not encode the recording: {err}"))?;
        for sample in samples {
            let clipped = sample.clamp(-1.0, 1.0);
            writer
                .write_sample((clipped * i16::MAX as f32) as i16)
                .map_err(|err| format!("Could not encode the recording: {err}"))?;
        }
        writer
            .finalize()
            .map_err(|err| format!("Could not encode the recording: {err}"))?;
    }
    Ok(cursor.into_inner())
}
