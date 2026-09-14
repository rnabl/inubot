import { useEffect, useMemo, useState } from "react";
import { createAndGrantSession, requestWebAuthnAccount, type Bootstrap } from "./alchemy";
import { createPasskey } from "./passkey";

type Status = "loading" | "ready" | "working" | "done" | "error";

export function App() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("t") ?? "", []);
  const [status, setStatus] = useState<Status>("loading");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [address, setAddress] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Detect Telegram WebView
  const isInTelegramBrowser = useMemo(() => {
    const ua = navigator.userAgent || "";
    return ua.includes("TelegramBot") || ua.includes("Telegram");
  }, []);

  useEffect(() => {
    if (!token) {
      setError("Open this page from the Telegram /start button.");
      setStatus("error");
      return;
    }
    
    // If in Telegram browser, just return - UI will show instructions
    if (isInTelegramBrowser) {
      return;
    }
    
    fetch(`/api/ceremony/bootstrap?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = (await res.json()) as Bootstrap & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Bootstrap failed");
        setBootstrap(body);
        if (body.alreadySetup && body.address) {
          setAddress(body.address);
          setStatus("done");
          return;
        }
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [token, isInTelegramBrowser]);

  async function onCreate() {
    if (!bootstrap) return;
    setStatus("working");
    setError("");
    try {
      // Use browser hostname to ensure rpId matches origin
      const rpId = window.location.hostname;
      const credential = await createPasskey(rpId, `tg:${bootstrap.telegramId}`);
      const accountAddress = await requestWebAuthnAccount(bootstrap.alchemyApiKey, rpId, credential);
      const permissions = await createAndGrantSession({
        apiKey: bootstrap.alchemyApiKey,
        policyId: bootstrap.policyId,
        rpId,
        credential,
        accountAddress,
        sessionPublicKey: bootstrap.sessionPublicKey,
        expirySec: bootstrap.expirySec,
        permissions: bootstrap.permissions,
      });
      const complete = await fetch("/api/ceremony/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          address: accountAddress,
          credentialId: credential.id,
          publicKey: credential.publicKey,
          permissions,
        }),
      });
      const body = (await complete.json()) as { error?: string; address?: string };
      if (!complete.ok) throw new Error(body.error ?? "Could not save wallet");
      setAddress(body.address ?? accountAddress);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("ready");
    }
  }

  return (
    <main className="wrap">
      <h1>InuBot wallet</h1>
      
      {isInTelegramBrowser ? (
        <div className="card" style={{ backgroundColor: "#fff3cd", border: "2px solid #ffc107", padding: "2rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", color: "#856404" }}>⚠️ Open in Safari</h2>
          <p style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
            Face ID/Touch ID won't work in Telegram's browser.
          </p>
          <p style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
            Tap the <strong>⋯</strong> (three dots) in the top right corner
            <br />
            and select <strong>"Open in Safari"</strong>
          </p>
        </div>
      ) : (
        <>
          <p>
            One Face ID creates a passkey-owned smart account. Telegram keeps a scoped session key for
            everyday swaps. Raising the cap or withdrawing needs Face ID again.
          </p>

          {bootstrap && !bootstrap.alreadySetup && status !== "done" && (
            <div className="card">
              <p>
                Daily cap: <strong>{bootstrap.dailyCapEth} ETH</strong>
              </p>
              <p>Session lasts 30 days, then automation stops until you renew.</p>
              <p>Lose this device without a second passkey and the wallet is unrecoverable.</p>
            </div>
          )}

          {status === "loading" && <p>Loading…</p>}
          {status === "ready" && (
            <p>
              <button type="button" onClick={onCreate}>
                Create wallet with Face ID
              </button>
            </p>
          )}
          {status === "working" && (
            <p>
              <button type="button" disabled>
                Waiting for Face ID…
              </button>
            </p>
          )}
          {status === "done" && (
            <div className="card">
              <p className="ok">Wallet ready. Return to Telegram and use /wallet.</p>
              <p className="mono">{address}</p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </main>
  );
}
