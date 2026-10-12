import {avcCodec} from '../src/media';
import {animationPose, transformMatrix} from '../shared/visual-transform.mjs';

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({VideoPlayer: class {}, MediaSource: class {}}));

describe('native media helpers', () => {
  it('reads the RFC 6381 codec from the avcC box of an init segment', () => {
    const avcC = [0x61, 0x76, 0x63, 0x43, 0x01, 0x64, 0x00, 0x1f, 0xff];
    expect(avcCodec(new Uint8Array([0, 0, 0, 0x20, ...avcC]))).toBe('avc1.64001f');
    expect(avcCodec(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
  });

  it('composes skew and rotation rather than flattening transforms', () => {
    const matrix = transformMatrix('translate(64.667px, -29.333px) scale(1.5) rotate(0.25turn)');
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[1]).toBeCloseTo(1.5);
    expect(matrix[2]).toBeCloseTo(-1.5);
    expect(matrix.slice(4)).toEqual([64.667, -29.333]);
    const frames = [{opacity: 0.4, transform: 'skewX(0deg)'}, {opacity: 1, transform: 'skewX(45deg)'}];
    expect(animationPose(frames, 0.5).matrix[2]).toBeCloseTo(Math.tan(Math.PI / 8));
    expect(animationPose(frames, 0.5).opacity).toBeCloseTo(0.7);
  });
});
