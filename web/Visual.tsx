import React from 'react';
import {visualPage} from '../server/visual-page.mjs';

export type VisualArtifact = {status: 'ready' | 'fallback' | 'none'; svg: string; description: string; animations: unknown[]};

export class Visual extends React.PureComponent<{visual: VisualArtifact; compact?: boolean; personal?: boolean}, {failed: boolean; play: number}> {
  state = {failed: false, play: 0};
  private frame = React.createRef<HTMLIFrameElement>();
  private nonce = document.querySelector<HTMLMetaElement>('meta[name="selene-renderer-nonce"]')?.content;
  componentDidMount() {window.addEventListener('message', this.receive);}
  componentWillUnmount() {window.removeEventListener('message', this.receive);}
  private replay = () => this.setState(({play}) => ({play: play + 1}));
  private receive = (event: MessageEvent) => {
    if (event.source === this.frame.current?.contentWindow && event.data === 'selene:visual-invalid') this.setState({failed: true});
  };
  render() {
    const {visual} = this.props;
    if (visual.status !== 'ready' || this.state.failed || !this.nonce) return <div className="visual-fallback">
      <p>{visual.description || 'The explanation is ready in words.'}</p>
      {(visual.status === 'fallback' || this.state.failed || !this.nonce) && <span className="small">Visual unavailable</span>}
    </div>;
    const page = visualPage(visual, this.nonce);
    return <button className="animated-visual" aria-label="Replay explanation animation" title="Replay animation" onClick={this.replay}>
      <iframe key={this.state.play} ref={this.frame} title={visual.description} sandbox="allow-scripts" srcDoc={page} tabIndex={-1} onError={() => this.setState({failed: true})} />
      <span className="visual-replay" aria-hidden="true">↻</span>
    </button>;
  }
}
