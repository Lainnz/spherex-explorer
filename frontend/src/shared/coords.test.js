import { describe, expect, it } from 'vitest';
import { formatDec, formatRa, parseCoordinates } from './coords.js';

const close = (actual, expected) => {
  expect(actual.ra).toBeCloseTo(expected.ra, 5);
  expect(actual.dec).toBeCloseTo(expected.dec, 5);
};

describe('parseCoordinates', () => {
  it('reads decimal degrees', () => {
    close(parseCoordinates('269.452 4.693'), { ra: 269.452, dec: 4.693 });
    close(parseCoordinates('269.452, +4.693'), { ra: 269.452, dec: 4.693 });
    close(parseCoordinates('133.795129 -7.245147'), { ra: 133.795129, dec: -7.245147 });
  });

  it("reads the team's WISE 0855 coordinates", () => {
    // 08h55m10.831s −7d14m42.53s (PLAN.md §1.1)
    close(parseCoordinates('08h55m10.831s -7d14m42.53s'), { ra: 133.7951292, dec: -7.2451472 });
    close(parseCoordinates('08h55m10.831s-07d14m42.53s'), { ra: 133.7951292, dec: -7.2451472 });
  });

  it('reads colons, spaces and symbol marks', () => {
    const barnard = { ra: (17 + 57 / 60 + 48.97 / 3600) * 15, dec: 4 + 41 / 60 + 36.1 / 3600 };
    close(parseCoordinates('17:57:48.97 +04:41:36.1'), barnard);
    close(parseCoordinates('17 57 48.97 +04 41 36.1'), barnard);
    close(parseCoordinates('17h57m48.97s +04°41′36.1″'), barnard);
    close(parseCoordinates("17h 57m 48.97s +04° 41' 36.1\""), barnard);
  });

  it('accepts the Unicode minus sign', () => {
    close(parseCoordinates('133.8 −7.2'), { ra: 133.8, dec: -7.2 });
  });

  it('treats names and nonsense as "not coordinates"', () => {
    for (const text of ["Barnard's Star", 'R Dra', 'WISE 0855', '', '400 10', '10 95', '-5 10',
      '25h00m00s +00d00m00s', '12h61m00s +00d00m00s', null]) {
      expect(parseCoordinates(text), String(text)).toBeNull();
    }
  });
});

describe('formatRa / formatDec', () => {
  it('formats as hours and degrees', () => {
    expect(formatRa(133.7951292)).toBe('08h55m10.83s');
    expect(formatDec(-7.2451472)).toBe('-07°14′42.5″');
    expect(formatDec(4.693)).toBe('+04°41′34.8″');
  });

  it('round-trips through the parser', () => {
    const text = `${formatRa(269.452)} ${formatDec(4.693).replace(/[°′]/g, ':').replace('″', '')}`;
    close(parseCoordinates(text), { ra: 269.452, dec: 4.693 });
  });
});
