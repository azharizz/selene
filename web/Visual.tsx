import React from 'react';
import {visualPage} from '../server/visual-page.mjs';
import {AvgVisual} from './AvgVisual';

export type VisualArtifact = {status: 'ready' | 'fallback' | 'none'; svg: string; description: string; animations: unknown[]};

export class Visual extends React.PureComponent<{visual: VisualArtifact; compact?: boolean; personal?: boolean}, {failed: boolean; play: number; renderer: 'svg' | 'avg'}> {
  state: {failed: boolean; play: number; renderer: 'svg' | 'avg'} = {failed: false, play: 0, renderer: 'svg'};
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
    if (visual.status !== 'ready') return <div className="visual-fallback">
      <p>{visual.description || 'The explanation is ready in words.'}</p>
      {visual.status === 'fallback' && <span className="small">Visual unavailable</span>}
    </div>;
    const svgUnavailable = this.state.failed || !this.nonce;
    return <div className="visual-preview">
      <div className="visual-renderer-choice" role="group" aria-label="Local diagram renderer">
        <button aria-pressed={this.state.renderer === 'svg'} onClick={() => this.setState({renderer: 'svg'})}>SVG</button>
        <button aria-pressed={this.state.renderer === 'avg'} onClick={() => this.setState({renderer: 'avg'})}>AVG / APL</button>
      </div>
      {this.state.renderer === 'svg' && svgUnavailable ? <div className="visual-fallback"><p>{visual.description}</p><span className="small">SVG unavailable</span></div> :
        <button className="animated-visual" aria-label="Replay explanation animation" title="Replay animation" onClick={this.replay}>
          {this.state.renderer === 'avg' ? <AvgVisual visual={visual} play={this.state.play}/> :
            <iframe key={this.state.play} ref={this.frame} title={visual.description} sandbox="allow-scripts" srcDoc={visualPage(visual, this.nonce!)} tabIndex={-1} onError={() => this.setState({failed: true})} />}
          <span className="visual-replay" aria-hidden="true">↻</span>
        </button>}
    </div>;
  }
}
