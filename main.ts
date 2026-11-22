import * as fs from "node:fs";
const OPS: [number,number,number,number][] = [
  [0x00,0,0,0],[0x01,1,0,1],[0x02,4,0,1],[0x03,0,1,0],
  [0x04,0,1,2],[0x05,0,2,2],[0x06,0,2,3],[0x07,0,3,3],
  [0x10,0,2,1],[0x11,0,2,1],[0x12,0,2,1],[0x13,0,2,1],
  [0x14,0,2,1],[0x15,0,2,1],[0x16,0,2,1],[0x17,0,1,1],
  [0x18,0,2,1],[0x19,0,2,1],[0x1a,0,2,1],[0x1b,0,1,1],
  [0x1c,0,2,1],[0x1d,0,2,1],[0x1e,0,2,1],[0x20,0,2,1],
  [0x21,0,2,1],[0x22,0,2,1],
  [0x30,2,0,0],[0x31,2,1,0],[0x32,2,1,0],[0x33,2,0,0],
  [0x34,0,0,0],[0x40,0,1,1],[0x41,0,2,0],
  [0x50,0,1,0],[0x51,0,1,0],[0x52,0,0,1],[0x53,0,1,0],
];
const KNOWN = new Uint8Array(256);
const IMM = new Uint8Array(256);
const NEED = new Uint8Array(256);
const MAKE = new Uint8Array(256);
for (const [b,i,p,q] of OPS) {
  KNOWN[b] = 1;
  IMM[b] = i;
  NEED[b] = p;
  MAKE[b] = q;
}
function runVM(prog: Uint8Array,inp: Uint8Array): { code: number; bytes: Uint8Array } {
  const n = prog.length;
  const S = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const done = (code: number) => ({ code,bytes: out.subarray(0,ol) });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    if (!KNOWN[op]) return done(5);
    const imm = IMM[op];
    if (pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    const pops = NEED[op];
    const pushes = MAKE[op];
    if (sp < pops) return done(2);
    if (sp - pops + pushes > 256) return done(3);
    pc = next;
    switch (op) {
      case 0x00:
        return done(0);
      case 0x01:
        S[sp++] = (prog[next - 1] << 24) >> 24;
        break;
      case 0x02:
        S[sp++] =
          prog[next - 4] |
          (prog[next - 3] << 8) |
          (prog[next - 2] << 16) |
          (prog[next - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04: {
        S[sp] = S[sp - 1];
        sp++;
        break;
      }
      case 0x05: {
        const t = S[sp - 1];
        S[sp - 1] = S[sp - 2];
        S[sp - 2] = t;
        break;
      }
      case 0x06:
        S[sp] = S[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = S[sp - 3];
        S[sp - 3] = S[sp - 2];
        S[sp - 2] = S[sp - 1];
        S[sp - 1] = a;
        break;
      }
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        const b = S[sp - 1];
        const a = S[sp - 2];
        let r: number;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a,b); break;
          case 0x13:
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : ((a / b) | 0);
            break;
          case 0x14:
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        sp -= 2;
        S[sp++] = r;
        break;
      }
      case 0x17:
        S[sp - 1] = (-S[sp - 1]) | 0;
        break;
      case 0x1b:
        S[sp - 1] = ~S[sp - 1];
        break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = S[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33: {
        if (cp === 64) return done(7);
        C[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      }
      case 0x34:
        if (cp === 0) return done(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const addr = S[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        S[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = S[sp - 1];
        const v = S[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(S[sp - 1]);
        if (ol + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return done(11);
        out[ol++] = S[--sp] & 255;
        break;
      case 0x52:
        S[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      default:
        return done(S[--sp] & 255);
    }
  }
}
const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const ids = fs
  .readdirSync(IN_DIR)
  .filter((d) => /^i\d{3}$/.test(d))
  .sort();
for (const id of ids) {
  const prog = fs.readFileSync(`${IN_DIR}/${id}/program.bin`);
  const inp = fs.readFileSync(`${IN_DIR}/${id}/input.bin`);
  const { code,bytes } = runVM(prog,inp);
  fs.mkdirSync(`${OUT_DIR}/${id}`,{ recursive: true });
  fs.writeFileSync(`${OUT_DIR}/${id}/stdout.bin`,bytes);
  fs.writeFileSync(`${OUT_DIR}/${id}/exit.txt`,String(code) + "\n");
}
