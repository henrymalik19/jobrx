"use client";

// Phone alerts in this browser: turned on (the browser asks permission, then its push subscription is saved),
// tested, or turned off. On an iPhone, alerts only work in Jobrx added to the home screen, so there it says
// how first.
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "./actions";

/** The app's public push key, as the browser wants it. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** What this browser is, to tell devices apart in the list. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Linux";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  return installed ? `${os} (home screen app)` : `${browser} on ${os}`;
}

type State =
  | { kind: "loading" }
  | { kind: "unsupported"; ios: boolean }
  | { kind: "blocked" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string };

/** Turns phone alerts on, off, or sends a test, in this browser. */
export function PhoneAlerts({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState({ kind: "unsupported", ios });
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const sub = await reg.pushManager.getSubscription();
      if (sub) return setState({ kind: "on", endpoint: sub.endpoint });
      setState(Notification.permission === "denied" ? { kind: "blocked" } : { kind: "off" });
    })().catch(() => setState({ kind: "unsupported", ios: false }));
  }, []);

  const turnOn = () =>
    start(async () => {
      setNote(null);
      try {
        if ((await Notification.requestPermission()) !== "granted") return setState({ kind: "blocked" });
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
        await savePushSubscriptionAction(sub.toJSON() as Parameters<typeof savePushSubscriptionAction>[0], deviceName());
        setState({ kind: "on", endpoint: sub.endpoint });
      } catch (err) {
        setNote(`Couldn't turn alerts on: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  const turnOff = () =>
    start(async () => {
      setNote(null);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
      }
      setState({ kind: "off" });
    });

  const test = () =>
    start(async () => {
      const reached = await sendTestPushAction();
      setNote(reached ? `Sent to ${reached} device${reached === 1 ? "" : "s"}.` : "Nothing was sent: no device is turned on, or the app's push keys aren't set.");
    });

  if (!publicKey) return <p className="text-sm text-muted-foreground">Phone alerts aren&apos;t set up on the server yet (VAPID keys).</p>;
  if (state.kind === "loading") return <p className="text-sm text-muted-foreground">Checking this browser…</p>;
  if (state.kind === "unsupported") {
    return state.ios ? (
      <p className="text-sm text-muted-foreground">
        On an iPhone, alerts work in Jobrx added to your home screen: tap Share, then <strong>Add to Home Screen</strong>, open Jobrx from
        there, and come back to this page.
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">This browser can&apos;t show alerts.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {state.kind === "blocked" ? (
        <p className="text-sm text-muted-foreground">Alerts are blocked for Jobrx in this browser. Allow notifications for jobrx.ai in its settings, then reload.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {state.kind === "on" ? (
            <>
              <Button variant="outline" onClick={turnOff} disabled={pending}>Turn off on this device</Button>
              <Button variant="outline" onClick={test} disabled={pending}>Send a test</Button>
            </>
          ) : (
            <Button onClick={turnOn} disabled={pending}>Turn on for this device</Button>
          )}
        </div>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
