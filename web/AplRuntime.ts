import Renderer, {Content, initEngine} from 'apl-viewhost-web';

// Eager within the lazy bundle: register the official engine's readiness handler
// before WASM initialization completes. No React adapter or external fonts/packages.
export const ready = initEngine();
export async function mount(document: object, commands: object[], view: HTMLElement, onError: (message: string) => void) {
  await ready;
  const width = Math.max(1, Math.round(view.clientWidth));
  const height = Math.max(1, Math.round(view.clientHeight));
  const content = Content.create(JSON.stringify(document));
  let disposed = false;
  const renderer = Renderer.create({content, view, viewport: {width, height, dpi: 160, isRound: false, shape: 'RECTANGLE'},
    environment: {agentName: 'SeleneLocalPreview', agentVersion: '1', disallowVideo: true, disallowDialog: true, disallowEditText: true},
    theme: 'dark', mode: 'TV', notLoadFonts: true, logLevel: 'error',
    onRunTimeError: errors => onError(`APL runtime: ${JSON.stringify(errors)}`),
    onSendEvent: event => {
      if (disposed || event.arguments[0] !== 'selene:avg-loop') return;
      const command = commands[Number(event.arguments[1])];
      if (command) renderer.executeCommands(JSON.stringify([{...command, delay: 0}]));
    }});
  const dispose = async () => {disposed = true; renderer.cancelExecution(); await renderer.stopUpdate(); renderer.destroy(); content.delete();};
  try {await renderer.init();} catch (error) {await dispose(); throw error;}
  return dispose;
}

// The official artifact needs dynamic embind wrappers. Its narrowly permitted
// eval lives only in /apl-preview.html, an opaque-origin allow-scripts sandbox.
if (window.parent !== window) {
  let generation = 0;
  let lifecycle = Promise.resolve();
  let dispose: (() => Promise<void>) | undefined;
  const report = (message: string) => window.parent.postMessage({type: 'selene:apl-error', message}, '*');
  window.addEventListener('error', event => report(event.message));
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== new URL(window.location.href).origin || event.data?.type !== 'selene:apl-render') return;
    const request = ++generation;
    const {document, commands} = event.data;
    lifecycle = lifecycle.catch(() => undefined).then(async () => {
      if (dispose) {await dispose(); dispose = undefined;}
      if (request !== generation) return;
      const view = window.document.getElementById('apl-root');
      if (!view || !document || !Array.isArray(commands)) throw new Error('Invalid local APL preview request');
      dispose = await mount(document, commands, view, report);
      if (request === generation) window.parent.postMessage({type: 'selene:apl-ready'}, '*');
    });
    void lifecycle.catch(error => {if (request === generation) report(error instanceof Error ? error.message : String(error));});
  });
  window.addEventListener('pagehide', () => {generation++; if (dispose) void dispose();}, {once: true});
}
