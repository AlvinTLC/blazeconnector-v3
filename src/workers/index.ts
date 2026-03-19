/**
 * Workers Module - BlazeConnector v3
 */

export { MessageWorker, getMessageWorker, startMessageWorkerInstance, stopMessageWorkerInstance } from './message-worker.js';

let _started = false;

export async function startMessageWorker(): Promise<void> {
  if (_started) return;
  const { startMessageWorkerInstance } = await import('./message-worker.js');
  await startMessageWorkerInstance();
  _started = true;
}

export async function stopMessageWorker(): Promise<void> {
  if (!_started) return;
  const { stopMessageWorkerInstance } = await import('./message-worker.js');
  await stopMessageWorkerInstance();
  _started = false;
}
