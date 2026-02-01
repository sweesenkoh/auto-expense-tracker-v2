import { ImapFlow } from 'imapflow';

export async function withGmailImap(env, fn) {
  const client = new ImapFlow({
    host: env.IMAP_HOST || 'imap.gmail.com',
    port: Number(env.IMAP_PORT || 993),
    secure: true,
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    },
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function fetchMessagesSince(client, { mailbox = 'INBOX', since }) {
  await client.mailboxOpen(mailbox);

  // Gmail often supports SINCE; ImapFlow uses search query objects
  const query = since
    ? { since: new Date(since) }
    : { all: true };

  const uids = await client.search(query);

  // Fetch bodies + envelope. We'll later hash normalized body.
  const messages = [];
  for await (const msg of client.fetch(uids, {
    uid: true,
    envelope: true,
    source: true,
    internalDate: true,
  })) {
    messages.push(msg);
  }
  return messages;
}
