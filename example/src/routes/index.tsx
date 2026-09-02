/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useState,
} from "react";
import {
  WORK_ITEM_NOTES_MAX_LENGTH,
  WORK_ITEM_TITLE_MAX_LENGTH,
  type WorkItem,
  type WorkItemStatus,
  workItemStatuses,
} from "@/lib/work-items";

type LoaderData =
  | {
      authenticated: false;
      items: [];
      signUpEnabled: boolean;
      verificationMode: false;
    }
  | {
      authenticated: true;
      items: WorkItem[];
      signUpEnabled: boolean;
      verificationMode: boolean;
    };

const statusLabels: Record<WorkItemStatus, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};

async function loadWorkItems(): Promise<LoaderData> {
  const configResponse = await fetch("/api/config");
  const config = configResponse.ok
    ? ((await configResponse.json()) as {
        authenticated: boolean;
        signUpEnabled: boolean;
        verificationMode: boolean;
      })
    : { authenticated: false, signUpEnabled: false, verificationMode: false };
  if (!config.authenticated)
    return {
      authenticated: false,
      items: [],
      signUpEnabled: config.signUpEnabled,
      verificationMode: false,
    };
  const response = await fetch("/api/work-items");
  if (!response.ok) throw new Error("Unable to load work items");
  const data = (await response.json()) as { items: WorkItem[] };
  return {
    authenticated: true,
    items: data.items,
    signUpEnabled: config.signUpEnabled,
    verificationMode: config.verificationMode,
  };
}

export const Route = createFileRoute("/")({
  ssr: false,
  loader: loadWorkItems,
  pendingComponent: LoadingPage,
  errorComponent: ErrorPage,
  component: WorkItemsPage,
});

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-8 text-slate-900 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-4xl">{children}</div>
    </main>
  );
}

function LoadingPage() {
  return (
    <PageShell>
      <div className="animate-pulse border-l-4 border-amber-500 pl-5">
        <div className="h-4 w-28 rounded bg-slate-300" />
        <div className="mt-4 h-12 max-w-md rounded bg-slate-300" />
        <div className="mt-3 h-5 max-w-lg rounded bg-slate-200" />
      </div>
      <div className="mt-12 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-24 rounded-xl bg-white/70" />
        ))}
      </div>
    </PageShell>
  );
}

function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageShell>
      <section className="mx-auto mt-24 max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-red-700">
          Connection interrupted
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Work items could not be loaded.
        </h1>
        <p className="mt-3 text-slate-600">
          Check the application connection and try again.
        </p>
        <button className="primary-button mt-7" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </PageShell>
  );
}

function WorkItemsPage() {
  const data = Route.useLoaderData();
  if (!data.authenticated) return <SignIn signUpEnabled={data.signUpEnabled} />;
  return (
    <AuthenticatedWorkItems
      items={data.items}
      verificationMode={data.verificationMode}
    />
  );
}

function SignIn({ signUpEnabled }: { signUpEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        creating ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(creating ? { name: form.get("name") } : {}),
            email: form.get("email"),
            password: form.get("password"),
          }),
        },
      );
      if (!response.ok) throw new Error();
      await router.invalidate();
    } catch {
      setError(
        creating
          ? "The account could not be created. Try another email."
          : "That email and password could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="grid min-h-[75vh] items-center gap-10 lg:grid-cols-[1.1fr_.9fr]">
        <header className="border-l-4 border-amber-500 pl-6">
          <p className="eyebrow">A focused place for the next thing</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-.04em] sm:text-6xl">
            Work items,
            <br /> without the noise.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-8 text-slate-600">
            Capture the work, move it forward, and close it out.
          </p>
        </header>
        <form
          className="rounded-2xl border border-slate-200 bg-white p-7 shadow-[0_18px_50px_-32px_rgba(15,23,42,.45)] sm:p-9"
          onSubmit={submit}
        >
          <h2 className="text-2xl font-semibold">
            {creating ? "Create account" : "Sign in"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {creating
              ? "Create a local development account."
              : "Work items are private to your account."}
          </p>
          {creating ? (
            <>
              <label className="field-label mt-7" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                name="name"
                autoComplete="name"
                maxLength={80}
                required
              />
            </>
          ) : null}
          <label
            className={`field-label ${creating ? "mt-5" : "mt-7"}`}
            htmlFor="email"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <label className="field-label mt-5" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
          <button
            className="primary-button mt-7 w-full"
            type="submit"
            disabled={busy}
          >
            {busy
              ? creating
                ? "Creating account..."
                : "Signing in..."
              : creating
                ? "Create account"
                : "Sign in"}
          </button>
          {signUpEnabled ? (
            <button
              className="auth-mode-button mt-4 w-full"
              type="button"
              onClick={() => {
                setCreating(!creating);
                setError("");
              }}
            >
              {creating ? "Use an existing account" : "Create a local account"}
            </button>
          ) : null}
        </form>
      </div>
    </PageShell>
  );
}

function AuthenticatedWorkItems({
  items,
  verificationMode,
}: {
  items: WorkItem[];
  verificationMode: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function mutate(path: string, method: string, body?: object) {
    setError("");
    setBusyId(path);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error();
      startTransition(() => void router.invalidate());
      return true;
    } catch {
      setError("The change could not be saved. Please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await mutate("/api/work-items", "POST", {
        title: data.get("title"),
        notes: data.get("notes"),
      })
    ) {
      form.reset();
    }
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    await router.invalidate();
  }

  return (
    <PageShell>
      <header className="flex items-start justify-between gap-6 border-l-4 border-amber-500 pl-5 sm:pl-7">
        <div>
          <p className="eyebrow">Work queue</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em] sm:text-5xl">
            Keep the work moving.
          </h1>
          <p className="mt-3 text-slate-600">
            {items.length === 0
              ? "Start with one concrete next step."
              : `${items.length} ${items.length === 1 ? "item" : "items"}, ordered by recent activity.`}
          </p>
        </div>
        {!verificationMode ? (
          <button
            className="icon-button"
            type="button"
            onClick={signOut}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        ) : null}
      </header>

      {verificationMode ? (
        <p className="mt-8 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          Verification fixture. Data is deterministic and changes are disabled.
        </p>
      ) : (
        <form
          className="mt-10 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,.55)] sm:grid-cols-[1fr_auto] sm:p-6"
          onSubmit={create}
        >
          <div className="grid gap-3">
            <label className="sr-only" htmlFor="new-title">
              Work item title
            </label>
            <input
              id="new-title"
              name="title"
              placeholder="What needs to happen?"
              maxLength={WORK_ITEM_TITLE_MAX_LENGTH}
              required
            />
            <label className="sr-only" htmlFor="new-notes">
              Notes
            </label>
            <textarea
              id="new-notes"
              name="notes"
              placeholder="Optional context"
              maxLength={WORK_ITEM_NOTES_MAX_LENGTH}
              rows={2}
            />
          </div>
          <button
            className="primary-button self-end"
            type="submit"
            disabled={busyId === "/api/work-items"}
          >
            <Plus className="size-4" />
            {busyId === "/api/work-items" ? "Adding..." : "Add item"}
          </button>
        </form>
      )}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-300 px-6 py-16 text-center">
          <p className="font-medium">No work items yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Add the first item above. Keep it specific and achievable.
          </p>
        </section>
      ) : (
        <section className="mt-8 space-y-3" aria-label="Work items">
          {items.map((item) => (
            <WorkItemRow
              key={item.id}
              item={item}
              busy={busyId === `/api/work-items/${item.id}`}
              readOnly={verificationMode}
              mutate={mutate}
            />
          ))}
        </section>
      )}
    </PageShell>
  );
}

function WorkItemRow({
  item,
  busy,
  readOnly,
  mutate,
}: {
  item: WorkItem;
  busy: boolean;
  readOnly: boolean;
  mutate: (path: string, method: string, body?: object) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const path = `/api/work-items/${item.id}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate(path, "PATCH", { title, notes })) setEditing(false);
  }

  async function remove() {
    if (window.confirm(`Delete “${item.title}”?`)) await mutate(path, "DELETE");
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm sm:p-5">
      {editing ? (
        <form className="grid gap-3" onSubmit={save}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={WORK_ITEM_TITLE_MAX_LENGTH}
            required
            aria-label="Title"
          />
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={WORK_ITEM_NOTES_MAX_LENGTH}
            rows={3}
            aria-label="Notes"
          />
          <div className="flex justify-end gap-2">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              <X className="size-4" /> Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busy}>
              <Check className="size-4" /> {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <select
            name={`status-${item.id}`}
            className={`status-select status-${item.status}`}
            value={item.status}
            onChange={(event) =>
              void mutate(path, "PATCH", {
                status: event.target.value as WorkItemStatus,
              })
            }
            disabled={busy || readOnly}
            aria-label={`Status for ${item.title}`}
          >
            {workItemStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex-1">
            <h2
              className={`font-semibold leading-6 ${item.status === "done" ? "text-slate-500 line-through decoration-slate-300" : ""}`}
            >
              {item.title}
            </h2>
            {item.notes ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {item.notes}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-slate-600">
              Updated {new Date(item.updatedAt).toLocaleDateString()}
            </p>
          </div>
          {!readOnly ? (
            <div className="flex gap-1 self-end sm:self-start">
              <button
                className="icon-button"
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${item.title}`}
              >
                <Pencil className="size-4" />
              </button>
              <button
                className="icon-button danger"
                type="button"
                onClick={remove}
                disabled={busy}
                aria-label={`Delete ${item.title}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
