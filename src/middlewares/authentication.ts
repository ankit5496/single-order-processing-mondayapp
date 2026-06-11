import jwt from "jsonwebtoken";
import express from "express";

declare global {
  namespace Express {
    interface Request {
      session: {
        accountId: string;
        userId: string;
        backToUrl: string | undefined;
        shortLivedToken: string | undefined;
      };
    }
  }
}

/** Middleware — verifies the monday sessionToken JWT to authenticate the request,
 *  then uses MONDAY_API_KEY for monday API calls.
 */
export function mondayTokenMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  let token = (req.headers.authorization ?? req.query?.token) as string | undefined;

  if (!token) {
    res.status(401).json({ error: "not authenticated, no credentials in request" });
    return;
  }

  // Strip "Bearer " prefix if present
  if (token.startsWith("Bearer ")) {
    token = token.substring(7);
  }

  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) {
    res.status(500).json({ error: "Missing MONDAY_SIGNING_SECRET" });
    return;
  }

  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing MONDAY_API_KEY" });
    return;
  }

  try {
    const decoded = jwt.verify(token, signingSecret) as any;
    const payload = decoded.dat ?? decoded;

    req.session = {
      accountId: String(payload.account_id ?? payload.accountId ?? ""),
      userId: String(payload.user_id ?? payload.userId ?? ""),
      backToUrl: undefined,
      shortLivedToken: apiKey,
    };

    next();
  } catch (err: any) {
    console.error("[auth] jwt.verify failed:", err.message);
    res.status(401).json({ error: "authentication error, could not verify credentials" });
  }
}

export default mondayTokenMiddleware;
