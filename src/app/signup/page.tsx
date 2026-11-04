import { Suspense } from "react";
import { SignupClient } from "./SignupClient";

export const metadata = { title: "Sign up — LedgerPulse" };

/** Query params are request-time data, so the client part renders inside a Suspense boundary. */
export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <Suspense fallback={<main className="min-h-[80vh]" />}>
      <SignupClient searchParams={searchParams} />
    </Suspense>
  );
}
