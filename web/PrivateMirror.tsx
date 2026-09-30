import React from 'react';
import {Visual, type VisualArtifact} from './Visual';
import {Voice, type VoiceState} from './voice';
import {focusPanel, moveFocus} from './navigation';
import {Brand} from './Brand';

type MirrorMoment = {
  state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  life_connection: {offered: boolean; question: string; recipient: string};
  grounding: {at_seconds: number};
};
type State = {moment: MirrorMoment | null; language: string; slowerAnswerVoice: boolean; error: string; voice: VoiceState};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export class PrivateMirror extends React.Component<{token: string}, State> {
  state: State = {moment: null, language: 'English', slowerAnswerVoice: false, error: '', voice: 'idle'};
  private root = React.createRef<HTMLElement>();
  private stream: EventSource | null = null;
  private mounted = false;
  private voice = new Voice(() => null,
    voice => {if (this.mounted) this.setState({voice});},
    error => {if (this.mounted) this.setState({error});});

  componentDidMount() {
    this.mounted = true;
    this.stream = new EventSource(`/api/private/${encodeURIComponent(this.props.token)}`);
    this.stream.onmessage = event => {
      try {
        const value = JSON.parse(event.data) as {type?: string; moment?: MirrorMoment; language?: string; slower_answer_voice?: boolean; error?: string};
        this.voice.stop();
        if (value.type === 'closed') {this.stream?.close(); this.stream = null; this.setState({moment: null, error: 'This private mirror is closed.'}); return;}
        if (value.type === 'ready') this.setState({moment: null, error: ''});
        if (value.type === 'moment' && value.moment) this.setState({moment: value.moment, language: value.language || 'English', slowerAnswerVoice: value.slower_answer_voice === true, error: ''});
        if (value.error) this.setState({error: value.error});
      } catch {this.setState({error: 'This private mirror sent an unreadable response.'});}
    };
    this.stream.onerror = () => {
      this.voice.stop(); this.stream?.close(); this.stream = null;
      if (this.mounted) this.setState({moment: null, error: 'The private mirror is unavailable. Return to SELENE and pair again.'});
    };
    window.addEventListener('keydown', this.key);
    focusPanel(this.root.current);
  }
  componentWillUnmount() {
    this.mounted = false; this.voice.stop(); this.stream?.close(); this.stream = null;
    window.removeEventListener('keydown', this.key);
  }
  private key = (event: KeyboardEvent) => {if (event.key.startsWith('Arrow')) {event.preventDefault(); moveFocus(event, this.root.current);}};
  private readAloud = () => {
    const {moment, language, voice} = this.state;
    if (!moment) return;
    if (voice === 'speaking') return this.voice.stop();
    this.voice.speak(moment.life_connection.offered ? moment.life_connection.question : moment.answer, language === 'Indonesian' ? 'id-ID' : language === 'Spanish' ? 'es-ES' : 'en-US', this.state.slowerAnswerVoice);
  };
  render() {
    const {moment, error, voice} = this.state;
    return <main className="app private-app" ref={this.root} tabIndex={-1}>
      <header className="private-heading"><Brand /><span>Private mirror</span>{moment && <span>At {clock(moment.grounding.at_seconds)}</span>}</header>
      {!moment && <section className="sheet" data-panel><h1>{error ? 'Private mirror unavailable' : 'Waiting for SELENE'}</h1><p role={error ? 'alert' : undefined}>{error || 'Your selected Moment Response will appear here. Keep this page open.'}</p></section>}
      {moment && <section className="moment full" data-panel>
        <header><span>Private mirror</span><span>At {clock(moment.grounding.at_seconds)}</span></header>
        <div className="moment-content"><div className="answer"><h2>{moment.answer || 'The shared screen is quiet.'}</h2>{moment.life_connection.offered && <p className="small">Life Connection: {moment.life_connection.question.replace(/\u2014/g, ',')}</p>}</div><div className="visual"><Visual visual={moment.visual} /></div></div>
        <footer className="actions">{voice !== 'idle' && <button onClick={() => this.voice.stop()}>Stop reading</button>}{voice === 'idle' && <button disabled={!this.voice.canSpeak} onClick={this.readAloud}>Read aloud on this device</button>}</footer>
      </section>}
      {moment && error && <p className="private-error" role="alert">{error}</p>}
    </main>;
  }
}
