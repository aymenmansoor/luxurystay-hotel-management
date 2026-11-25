#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# This drill owns its container and never uses the application's MongoDB URI.
port=27117
fixture=$(docker run -d --rm -p "127.0.0.1:$port:$port" mongo:8.0   mongod --replSet restartFixture --bind_ip_all --port "$port")
trap 'docker rm -f "$fixture" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$fixture" mongosh --quiet --port "$port" --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$fixture" mongosh --quiet --port "$port"   --eval 'rs.initiate({_id:"restartFixture",members:[{_id:0,host:"localhost:27117"}]})' >/dev/null

MONGO_RESTART_CONTAINER="$fixture" node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const docker = promisify(execFile);
const connection = await mongoose.createConnection(
  'mongodb://127.0.0.1:27117/restart_fixture?replicaSet=restartFixture',
  { serverSelectionTimeoutMS: 1500 }
).asPromise();
try {
  const collection = connection.db.collection('ledger');
  await connection.transaction((session) => collection.insertOne({ _id: 'before', amount: 1200 }, { session }));
  const started = performance.now();
  const restarted = docker('docker', ['restart', '-t', '5', process.env.MONGO_RESTART_CONTAINER]);
  const samples = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const begin = performance.now();
    await connection.db.command({ ping: 1 }).then(
      () => samples.push({ ok: true, ms: performance.now() - begin }),
      () => samples.push({ ok: false, ms: performance.now() - begin })
    );
    if (samples.some((sample) => !sample.ok) && samples.at(-1).ok) break;
    await pause(150);
  }
  await restarted;
  assert.ok(samples.some((sample) => !sample.ok), 'An outage must be observed');
  assert.ok(samples.at(-1)?.ok, 'The same driver connection must recover');
  await connection.transaction((session) => collection.insertOne({ _id: 'after', amount: 300 }, { session }));
  const records = await collection.find().sort({ _id: -1 }).toArray();
  assert.deepEqual(records, [{ _id: 'before', amount: 1200 }, { _id: 'after', amount: 300 }]);
  const durations = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const percentile = (p) => Math.round(durations[Math.ceil(durations.length * p) - 1]);
  console.log(JSON.stringify({ recoveryMs: Math.round(performance.now() - started), clients: 1,
    probes: samples.length, unavailable: samples.filter((sample) => !sample.ok).length,
    p50Ms: percentile(.5), p95Ms: percentile(.95), committedRecords: records.length }));
} finally {
  await connection.close();
}
NODE
