"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { PRICING } from "@/lib/schemas";

export const LEGAL_EFFECTIVE_DATE = "November 6, 2026";

type LegalDoc = "terms" | "privacy";

/** Footer links that open the Terms of Service / Privacy Policy in a modal. */
export function LegalLinks({ className }: { className?: string }) {
  const [open, setOpen] = useState<LegalDoc | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen("terms")} className={className}>
        Terms of Service
      </button>
      <button type="button" onClick={() => setOpen("privacy")} className={className}>
        Privacy Policy
      </button>
      {open && <LegalModal doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function LegalModal({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  return (
    <Modal size="lg" title={doc === "terms" ? "Terms of Service" : "Privacy Policy"} subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`} onClose={onClose}>
      <div className="space-y-5 text-sm leading-relaxed text-slate-300">{doc === "terms" ? <TermsContent /> : <PrivacyContent />}</div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold text-slate-100">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TermsContent() {
  return (
    <>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of Sumhaven (the &quot;Service&quot;). By creating an account, uploading documents or
        purchasing a plan, you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <Section title="1. No professional advice">
        <p>
          Sumhaven is informational and analytical planning software only. It is <strong>not</strong> a certified public accountant (CPA), accounting firm,
          tax preparer, financial adviser, attorney or fiduciary, and nothing in the Service (including audits, flags, savings estimates, projections,
          scenarios, executive reports or AI assistant replies) constitutes accounting, tax, legal, investment or other professional advice.
        </p>
        <p>
          Outputs are generated in part by automated and AI systems and may be incomplete or inaccurate. Consult a qualified professional before making
          financial, tax or legal decisions.
        </p>
      </Section>

      <Section title="2. Your responsibility for accuracy">
        <p>
          You are solely responsible for the documents you upload and the information you enter, and for reviewing and verifying every parsed figure,
          line item, category, reconciliation, de-duplication and total before relying on it. Statement parsing and classification can misread
          amounts, dates or descriptions. You remain responsible for any decision you make using the Service.
        </p>
        <p>You confirm you have the right to upload and process every document you submit.</p>
      </Section>

      <Section title="3. Accounts">
        <p>
          Keep your sign-in credentials confidential. You are responsible for activity under your account. You may delete your workspace data at any time
          from Settings &amp; Billing → Danger Zone.
        </p>
      </Section>

      <Section title="4. Subscriptions, billing and access codes">
        <p>
          Sumhaven Pro is billed in advance at ${PRICING.proMonthlyUsd} per month or ${PRICING.proAnnualUsd} per year through our payment processor, Stripe,
          and renews automatically until cancelled. You can cancel at any time from Settings &amp; Billing; access continues until the end of the paid period.
          Except where required by law, fees are non-refundable. Charges appear on your statement as &quot;SUMHAVEN PRO&quot;.
        </p>
        <p>
          VIP or promotional access codes are personal, non-transferable, have no cash value and may be revoked if misused or obtained without
          authorization.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>
          Do not misuse the Service: no unlawful content, no attempts to bypass paywalls, access controls or rate limits, no reverse engineering, scraping or
          automated abuse, and no uploading of documents you are not authorized to share.
        </p>
      </Section>

      <Section title="6. Disclaimer of warranties">
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, express or implied, including
          merchantability, fitness for a particular purpose, accuracy and non-infringement. We do not warrant that the Service will be uninterrupted,
          error-free or that any projection will be achieved.
        </p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>
          To the maximum extent permitted by law, Sumhaven and its owners, operators and suppliers will not be liable for any indirect, incidental,
          special, consequential, exemplary or punitive damages, or for any lost profits, revenue, savings, data or business opportunities, arising from or
          related to your use of the Service or reliance on its outputs.
        </p>
        <p>
          Our total aggregate liability for all claims relating to the Service is limited to the greater of (a) the total fees you paid to Sumhaven in the
          twelve (12) months preceding the event giving rise to the claim, or (b) one hundred U.S. dollars ($100).
        </p>
      </Section>

      <Section title="8. Indemnity">
        <p>
          You agree to indemnify and hold Sumhaven harmless from claims arising out of the documents or data you submit, your use of the Service, or your
          breach of these Terms.
        </p>
      </Section>

      <Section title="9. Changes and termination">
        <p>
          We may update the Service or these Terms; material changes will be posted in the app with a new effective date. Continued use after a change
          means you accept it. We may suspend accounts that violate these Terms. You may stop using the Service at any time.
        </p>
      </Section>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <p>
        This Privacy Policy explains what Sumhaven collects, how statements and financial extracts are processed, and the choices you have. We built
        Sumhaven to keep as little of your financial data as possible.
      </p>

      <Section title="1. What we process">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Uploaded statements (PDFs and pasted text).</strong> Files are sent over an encrypted connection, parsed in memory and discarded when the
            request finishes. The original files are never written to disk or stored in our database.
          </li>
          <li>
            <strong>Financial extracts you keep.</strong> Inside each workspace we store what was parsed and reviewed from your documents (document name,
            statement month, line items and totals), your latest report and report history, your Fiscal Year Tracker and any scenarios you choose to save,
            so your work persists between sessions.
          </li>
          <li>
            <strong>Account data.</strong> Your email address, plan and subscription status. Card details are entered directly with Stripe; we never see or
            store them.
          </li>
          <li>
            <strong>On your device.</strong> Preferences (such as theme) and unsent form drafts are kept in your browser&apos;s local storage.
          </li>
        </ul>
      </Section>

      <Section title="2. How your data is protected">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Encryption in transit:</strong> all traffic between your browser, our servers and our providers uses TLS (HTTPS).
          </li>
          <li>
            <strong>Encryption at rest:</strong> stored data lives in our Supabase (PostgreSQL) database, which is encrypted at rest.
          </li>
          <li>
            <strong>Isolation:</strong> row-level security restricts every stored record to the account that created it, and each workspace&apos;s data is
            kept separate from your other workspaces.
          </li>
          <li>
            <strong>Sealed previews:</strong> locked report content is encrypted (AES-256-GCM) with a server-held key and only opened after you unlock it.
          </li>
        </ul>
      </Section>

      <Section title="3. We never sell your data">
        <p>
          Your financial data is never sold, rented, harvested for advertising or data brokering, or shared with third parties for their own purposes. We
          do not use it to train AI models.
        </p>
        <p>
          To run the Service we rely on a small number of service providers that process data only on our behalf and under confidentiality and security
          obligations: Supabase (database and sign-in), our AI model provider (to read statements and generate the analysis; statement content is sent for
          that request only) and Stripe (payments). We may disclose information if required by law.
        </p>
      </Section>

      <Section title="4. Retention and deletion">
        <p>
          Stored workspace data is kept until you delete it. You can delete a single workspace, or everything at once from Settings &amp; Billing → Danger
          Zone (&quot;Delete All Workspace &amp; Document Data&quot;), which permanently removes your workspaces, saved documents, reports, trackers,
          scenarios and feedback. Billing records required for accounting and tax purposes are kept by Stripe.
        </p>
      </Section>

      <Section title="5. Your rights">
        <p>
          Depending on where you live, you may have rights to access, correct, export or delete your personal information. Use the in-app tools or contact
          us through the app&apos;s feedback form to make a request.
        </p>
      </Section>

      <Section title="6. Changes">
        <p>We will post any changes to this policy here with a new effective date.</p>
      </Section>
    </>
  );
}
