// Temporary helper endpoint — only needed once, during setup, to find the
// Group ID of your team's LINE group.
//
// Setup:
//   1) Deploy this file (put it in your project's /api folder, alongside
//      notify-line.js, and deploy to Vercel as usual).
//   2) In the LINE Developers Console, on your channel's "Messaging API"
//      tab, set the Webhook URL to:
//         https://<your-vercel-domain>/api/line-webhook
//      then turn on "Use webhook".
//   3) Make sure the bot has already been invited into your team's LINE
//      group (see the step-by-step guide).
//   4) Type anything in that LINE group.
//   5) Open your Vercel project -> Deployments -> (latest) -> Functions ->
//      line-webhook -> Logs. You'll see a line like:
//         LINE Group ID: Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//      Copy that value into the LINE_GROUP_ID environment variable.
//
// You can leave this file in place afterwards — it doesn't do anything
// harmful if left connected, it just logs group IDs whenever the bot
// receives a message. You can also disable the webhook in the LINE
// console once you have the Group ID.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }
  try {
    const events = (req.body && req.body.events) || [];
    for (const event of events) {
      if (event.source && event.source.type === "group") {
        console.log("LINE Group ID:", event.source.groupId);
      } else if (event.source && event.source.type === "user") {
        console.log("LINE User ID:", event.source.userId);
      }
    }
  } catch (e) {
    console.error("line-webhook error", e);
  }
  // LINE requires a 200 response quickly, regardless of what we did above.
  res.status(200).json({ ok: true });
}
