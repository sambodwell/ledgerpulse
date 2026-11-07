"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client half of the admin guard. The API routes are the real gate (they re-verify the caller's JWT against
 * ADMIN_EMAILS and answer 401 / 403); when they say "forbidden", a non-admin is sent back to the dashboard instead
 * of being left on an admin page.
 */
export function useAdminRedirect(status: number | null | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (status === 403) router.replace("/dashboard");
  }, [status, router]);
}
