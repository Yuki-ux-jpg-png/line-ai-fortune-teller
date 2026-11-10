export const emailDeliveryAudience =
  "https://ibasho-kokoro.vercel.app/api/member/notification-email";
/** No arbitrary URL, recipient, subject or message body is accepted. */
export async function emailDelivery(
  authorization: string,
  payload:
    { preflight: true } | { subject: string; receipt: string; jobId: string },
  fetcher: typeof fetch = fetch,
) {
  if (!authorization.startsWith("Bearer ") || authorization.length > 16000)
    throw new Error("EMAIL_JOB_AUTHORIZATION");
  const r = await fetcher(emailDeliveryAudience, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`EMAIL_DELIVERY_${r.status}`);
  return r.json() as Promise<{
    ok?: boolean;
    cancelled?: boolean;
    smtpVerified?: number;
  }>;
}
