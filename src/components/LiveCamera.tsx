import { useEffect, useRef, useState } from 'react';
import { fitSize } from '../lib/compress';

/**
 * In-page camera for the gate photo (Batch A6): the frame comes from getUserMedia, so it can
 * only be what the lens sees now — no gallery. The stream is stopped after a capture, on
 * cancel and on unmount; a retake opens it again. The blob is already sized and JPEG-encoded
 * like `compressImage` output, so it goes straight to the upload.
 */
export default function LiveCamera({
  maxEdge, onCapture, onCancel, onError,
}: {
  maxEdge: number;
  onCapture: (b: Blob) => void;
  onCancel: () => void;
  /** getUserMedia refused or missing; the DOMException name, if any. */
  onError: (name: string | undefined) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [shot, setShot] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { onError(undefined); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      stream.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => undefined);   // autoplay+muted normally covers it
      }
      setReady(true);
    } catch (e) {
      stop();
      onError(e instanceof DOMException ? e.name : undefined);
    }
  };

  useEffect(() => {
    void start();
    return stop;
  }, []);

  useEffect(() => {
    if (!shot) { setPreview(null); return; }
    const url = URL.createObjectURL(shot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const { width, height } = fitSize(v.videoWidth, v.videoHeight, maxEdge);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')?.drawImage(v, 0, 0, width, height);
    c.toBlob((b) => {
      if (!b) return;
      stop();
      setShot(b);
    }, 'image/jpeg', 0.7);
  };

  const retake = () => { setShot(null); void start(); };

  return (
    <div className="livecam">
      {/* Stays mounted so a retake can reattach the stream without waiting for a render. */}
      <video ref={videoRef} playsInline muted autoPlay hidden={!!preview} />
      {preview && <img className="thumb" src={preview} alt="صورة باب الفرع" />}
      {shot ? (
        <div className="photorow">
          <button type="button" className="send" onClick={() => onCapture(shot)}>تمام</button>
          <button type="button" className="ghost" onClick={retake}>صوّر تاني</button>
        </div>
      ) : (
        <button type="button" className="send" disabled={!ready} onClick={capture}>
          {ready ? '📷 التقاط' : 'جارٍ فتح الكاميرا…'}
        </button>
      )}
      <button type="button" className="ghost" onClick={() => { stop(); onCancel(); }}>إلغاء</button>
    </div>
  );
}
