// Git's object id of a file (SHA-1 of "blob <size>\0" and the bytes), from
// its base64 content, so the folder can be compared with a commit's tree
// without downloading it. WebCrypto, in the app window and in Node.

async function blobSha(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function blobShas(files) {
  const out = {};
  for (const [name, content] of Object.entries(files)) out[name] = await blobSha(content);
  return out;
}
