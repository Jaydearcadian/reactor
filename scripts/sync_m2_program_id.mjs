import fs from "node:fs";
import { Keypair } from "@solana/web3.js";

const keypairPath = process.env.REACTOR_PROGRAM_KEYPAIR ?? "target/deploy/reactor-keypair.json";
const sourcePath = "programs/reactor/src/program.rs";

if (!fs.existsSync(keypairPath)) {
  throw new Error(`missing ${keypairPath}; run 'anchor build' once so Anchor creates the local program keypair`);
}

const secret = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
const programId = Keypair.fromSecretKey(secret).publicKey.toBase58();
let source = fs.readFileSync(sourcePath, "utf8");
const pattern = /declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\);/;
if (!pattern.test(source)) throw new Error(`declare_id! not found in ${sourcePath}`);
source = source.replace(pattern, `declare_id!("${programId}");`);
fs.writeFileSync(sourcePath, source);
console.log(programId);
