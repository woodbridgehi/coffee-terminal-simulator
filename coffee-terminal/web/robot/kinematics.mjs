// Metres, Y up. Generic educational 6R arm, not a vendor calibration.
export const ARM = Object.freeze({ shoulder: 0.24, upper: 0.66, forearm: 0.62, tool: 0.24 });
export const BASES = Object.freeze({ left: [-0.94, 0.96, 0.20], right: [0.94, 0.96, 0.20] });
export const LIMITS = [[-180, 180], [-150, 150], [-160, 160], [-180, 180], [-180, 180], [-180, 180]];
export const rad = (degrees) => degrees * Math.PI / 180;
export const deg = (radians) => radians * 180 / Math.PI;
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Closed-form position IK with an upright cup. Last wrist joint remains free. */
export function solveUpright(target, base, roll = 0) {
  if (target.length !== 3 || base.length !== 3 || ![...target, ...base, roll].every(Number.isFinite)) {
    throw new RangeError('目标坐标必须是有限数值');
  }
  const dx = target[0] - base[0], dz = target[2] - base[2];
  const r = Math.hypot(dx, dz);
  const h = target[1] + ARM.tool - base[1] - ARM.shoulder;
  const cosine = (r * r + h * h - ARM.upper ** 2 - ARM.forearm ** 2) / (2 * ARM.upper * ARM.forearm);
  if (cosine < -1 || cosine > 1) throw new RangeError('目标超出机械臂工作范围');
  const beta = Math.acos(cosine);
  const shoulder = -(Math.atan2(r, h) - Math.atan2(ARM.forearm * Math.sin(beta), ARM.upper + ARM.forearm * Math.cos(beta)));
  const elbow = -beta;
  const joints = [Math.atan2(-dz, dx), shoulder, elbow, 0, wrap(Math.PI - shoulder - elbow), roll];
  if (joints.some((q, i) => deg(q) < LIMITS[i][0] - 1e-6 || deg(q) > LIMITS[i][1] + 1e-6)) {
    throw new RangeError('目标姿态超出关节限制');
  }
  return joints;
}

export const smooth = (t) => t * t * (3 - 2 * t);
export const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
