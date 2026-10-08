import React from 'react';
import {focusPanel} from './navigation';
import {LoadingMark} from './Brand';

const captionLimit = 1048576;
type Props = {getSession: (signal: AbortSignal) => Promise<string>; onImported: (id: string) => void; onCancel: () => void};

export class MediaImport extends React.Component<Props, {captions: string; busy: boolean; reading: boolean; error: string}> {
  state = {captions: '', busy: false, reading: false, error: ''};
  private controller: AbortController | null = null;
  private reader: FileReader | null = null;
  private mounted = false;
  private cancelButton = React.createRef<HTMLButtonElement>();
  private errorMessage = React.createRef<HTMLParagraphElement>();

  componentDidMount() {
    this.mounted = true;
    document.addEventListener('visibilitychange', this.background);
    window.addEventListener('pagehide', this.abort);
  }
  componentWillUnmount() {
    this.mounted = false; this.abort();
    document.removeEventListener('visibilitychange', this.background);
    window.removeEventListener('pagehide', this.abort);
  }
  private abort = () => {this.controller?.abort(); this.reader?.abort();};
  private background = () => {if (document.hidden) this.abort();};
  private cancel = () => {this.abort(); this.props.onCancel();};
  private fail = (error: string) => this.setState({error}, () => this.errorMessage.current?.focus());
  private readCaptions = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    this.setState({captions: ''});
    if (!file) return;
    if (!/\.(srt|vtt)$/i.test(file.name) || file.size > captionLimit) {
      input.value = '';
      this.fail('Choose an SRT or VTT caption file of at most 1 MiB.'); return;
    }
    const reader = new FileReader(); this.reader = reader;
    this.setState({reading: true, error: ''}, () => this.cancelButton.current?.focus());
    reader.onload = () => {if (this.mounted && this.reader === reader) this.setState({captions: String(reader.result ?? '')});};
    reader.onerror = () => {if (this.mounted && this.reader === reader) {input.value = ''; this.fail('The caption file could not be read. Choose the file again.');}};
    reader.onabort = () => {input.value = '';};
    reader.onloadend = () => {if (this.mounted && this.reader === reader) {this.reader = null; this.setState({reading: false});}};
    reader.readAsText(file);
  };
  private submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (this.state.busy || this.state.reading) return;
    if (new TextEncoder().encode(this.state.captions).length > captionLimit) {this.fail('Caption text must be at most 1 MiB.'); return;}
    const fields = new FormData(event.currentTarget);
    const controller = new AbortController(); this.controller = controller;
    const body = {
      url: String(fields.get('url')).trim(), title: String(fields.get('title')).trim(),
      ...(this.state.captions.trim() ? {captions: this.state.captions} : {}),
    };
    this.setState({busy: true, error: ''}, () => this.cancelButton.current?.focus());
    try {
      const session = await this.props.getSession(controller.signal);
      if (controller.signal.aborted) return;
      const response = await fetch('/api/media/import', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': session}, body: JSON.stringify(body), signal: controller.signal});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The MP4 could not be imported. Try again.');
      if (typeof result.story?.id !== 'string') throw new Error('The service did not return an imported film.');
      if (this.mounted && !controller.signal.aborted) this.props.onImported(result.story.id);
    } catch (error) {
      if (this.mounted && !controller.signal.aborted) this.fail(error instanceof Error ? error.message : 'The import could not finish. Check the connection and try again.');
    } finally {
      if (this.controller === controller) {this.controller = null; if (this.mounted) this.setState({busy: false});}
    }
  };
  private key = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // Keep left/right caret editing; up/down moves through every TV form control.
    const vertical = ['ArrowUp', 'ArrowDown'].includes(event.key);
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key) && target.matches('button,input[type=file]');
    if (!vertical && !horizontal) {
      if (event.key === 'Enter' && target.matches('input')) {
        event.preventDefault(); event.stopPropagation();
        if (target.matches('input[type=file]')) {target.click(); return;}
      } else return;
    } else {event.preventDefault(); event.stopPropagation();}
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')).filter(item => item.getClientRects().length);
    const index = controls.indexOf(target);
    const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const next = controls[Math.max(0, Math.min(controls.length - 1, index + direction))];
    next?.focus(); next?.scrollIntoView({block: 'nearest'});
  };
  render() {
    const {busy, reading, error} = this.state;
    return <><section className="sheet media-import" hidden={busy} data-panel ref={focusPanel} aria-label="Import MP4" onKeyDown={this.key}>
      <div className="sheet-head"><h1>Import MP4</h1><button ref={busy ? undefined : this.cancelButton} data-initial onClick={this.cancel}>Cancel</button></div>
      <p className="small muted">Imports the full video. Import only media you have permission to use. Storage and model costs apply.</p>
      <form onSubmit={this.submit} aria-busy={busy || reading}>
        <fieldset disabled={busy || reading}>
          <label>HTTPS MP4 URL<input name="url" type="url" pattern="https://.*" required maxLength={2048} placeholder="https://publisher.example/film.mp4" /></label>
          <label>Upload SRT / VTT (optional)<input type="file" accept=".srt,.vtt,text/plain,text/vtt" onChange={this.readCaptions} aria-describedby="import-caption-help" /></label>
          <label>Title<input name="title" required maxLength={500} /></label>
          <p id="import-caption-help" className="small muted">Without supplied or embedded captions, Selene can explain images but not dialogue.</p>
          <button className="primary" type="submit">Import and open</button>
        </fieldset>
      </form>
      {reading && <p role="status">Reading the local caption file…</p>}
      {error && <p ref={this.errorMessage} tabIndex={-1} role="alert">{error}</p>}
    </section>{busy && <section className="loading-panel" data-panel ref={focusPanel} aria-label="Importing MP4">
      <button ref={this.cancelButton} data-initial aria-label="Cancel import" onClick={this.cancel}><LoadingMark/></button>
      <p className="sr-only" role="status">Preparing the imported film. Cancel stops processing.</p>
    </section>}</>;
  }
}
