import {avcCodec} from '../src/media';
import {pose} from '../src/Visual';

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({VideoPlayer: class {}, MediaSource: class {}}));
jest.mock('@amazon-devices/react-native-svg', () => ({__esModule: true, default: 'Svg', G: 'G'}));

describe('native media helpers', () => {
  it('reads the RFC 6381 codec from the avcC box of an init segment', () => {
    const avcC = [0x61, 0x76, 0x63, 0x43, 0x01, 0x64, 0x00, 0x1f, 0xff];
    expect(avcCodec(new Uint8Array([0, 0, 0, 0x20, ...avcC]))).toBe('avc1.64001f');
    expect(avcCodec(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
  });

  it('turns validated keyframe transforms into an animatable pose', () => {
    expect(pose({opacity: 0.4, transform: 'translate(64.667px, -29.333px) scale(1.5) rotate(0.25turn)'}))
      .toEqual({opacity: 0.4, translateX: 64.667, translateY: -29.333, scaleX: 1.5, scaleY: 1.5, rotation: 90});
    expect(pose({})).toEqual({opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0});
    expect(pose({transform: 'scale(1, 2) rotate(3.14159rad)'}).scaleY).toBe(2);
  });
});
