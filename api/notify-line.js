// Pushes a text message to the team's LINE group via the LINE Messaging
// API. The channel access token stays server-side (Vercel environment
// variable) and is never sent to the browser — the React app just calls
// this endpoint with the message text.
//
// Required Vercel environment variables (Project Settings -> Environment
// Variables, then redeploy):
//   LINE_CHANNEL_ACCESS_TOKEN  -- from LINE Developers Console, Messaging
//                                 API tab -> "Channel access token (long-lived)"
//   LINE_GROUP_ID              -- the group's ID, obtained once via
//                                 api/line-webhook.js (see that file)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "missing 'message' string in request body" });
    return;
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  if (!token || !groupId) {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN / LINE_GROUP_ID not set — skipping LINE push");
    res.status(200).json({ ok: false, skipped: true });
    return;
  }

  try {
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: message }],
      }),
    });
    if (!lineRes.ok) {
      const detail = await lineRes.text();
      console.error("LINE push failed", lineRes.status, detail);
      res.status(502).json({ ok: false, error: "LINE API error", detail });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-line error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
}
