// audio_encoder.rs, it is an audio encoder trait definition for the ffmpeg library.
// It provides a common interface for audio encoders, allowing them to send audio frames and flush the encoder.
// The trait includes a method to box the encoder for dynamic dispatch, as well as methods to send audio frames and flush the encoder's output.
use ffmpeg::{format, frame};

pub trait AudioEncoder {
    fn boxed(self) -> Box<dyn AudioEncoder + Send + 'static>
    where
        Self: Send + Sized + 'static,
    {
        Box::new(self)
    }

    fn send_frame(&mut self, frame: frame::Audio, output: &mut format::context::Output);
    fn flush(&mut self, output: &mut format::context::Output) -> Result<(), ffmpeg::Error>;
}
