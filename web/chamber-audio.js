// Only decode the pitches and dynamics actually used in a take. Each region in
// an offline bank is an independent lossless stereo FLAC stream.
export async function decodeRecordings(requests) {
  const decoder = new OfflineAudioContext(2, 1, 32000);
  const recordings = {}, transfers = [];
  for (const [url, regions] of Object.entries(requests)) {
    const res = await fetch(new URL(url, document.baseURI));
    if (!res.ok) throw Error("Could not load the acoustic recordings.");
    const bank = await res.arrayBuffer();
    for (const { id, offset, bytes, frames } of regions) {
      const chunk = await decoder.decodeAudioData(bank.slice(offset, offset + bytes));
      if (chunk.numberOfChannels !== 2 || chunk.length !== frames)
        throw Error("The decoded recording has an unexpected format.");
      const left = chunk.getChannelData(0).slice(), right = chunk.getChannelData(1).slice();
      recordings[id] = [left, right];
      transfers.push(left.buffer, right.buffer);
    }
  }
  return { recordings, transfers };
}
