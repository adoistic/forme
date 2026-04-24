import React, { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import {
  useNavStore,
  useShallow as useNavShallow,
  type SettingsTab,
} from "../../stores/navigation.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import { StorageSettings } from "./StorageSettings.js";
import type { PublisherProfile } from "@shared/ipc-contracts/channels.js";
import type { Language } from "@shared/schemas/language.js";

const DEFAULT_PROFILE: PublisherProfile = {
  publicationName: "",
  accentColor: null,
  typographyPairingDefault: "Editorial Serif",
  primaryLanguageDefault: "en",
  pageSizeDefault: "A4",
  issueCadence: "weekly",
  printerContact: null,
  classifiedsBillingLabel: "Billing Ref",
};

export function SettingsScreen(): React.ReactElement {
  const { profile, refreshProfile } = useIssueStore(
    useShallow((s) => ({ profile: s.profile, refreshProfile: s.refreshProfile }))
  );
  const { settingsTab, setSettingsTab } = useNavStore(
    useNavShallow((s) => ({ settingsTab: s.settingsTab, setSettingsTab: s.setSettingsTab }))
  );

  return (
    <Tabs.Root
      value={settingsTab}
      onValueChange={(v) => setSettingsTab(v as SettingsTab)}
      className="flex h-full flex-col overflow-hidden"
    >
      <header className="border-border-default flex h-16 shrink-0 items-center justify-between border-b px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Settings</h1>
          <div className="text-caption text-text-tertiary">Publisher Profile + storage usage.</div>
        </div>
        <Tabs.List
          aria-label="Settings sections"
          className="bg-bg-canvas inline-flex items-center gap-1 rounded-md p-1"
        >
          <SettingsTabTrigger value="profile" label="Profile" />
          <SettingsTabTrigger value="storage" label="Storage" />
        </Tabs.List>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <Tabs.Content value="profile" className="mx-auto max-w-[720px]">
          <ProfileForm profile={profile} refreshProfile={refreshProfile} />
        </Tabs.Content>
        <Tabs.Content value="storage" className="mx-auto max-w-[920px]">
          <StorageSettings />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}

function SettingsTabTrigger({
  value,
  label,
}: {
  value: SettingsTab;
  label: string;
}): React.ReactElement {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={`settings-tab-${value}`}
      className={[
        "text-title-sm rounded px-3 py-1.5 transition-colors",
        "text-text-secondary hover:text-text-primary",
        "data-[state=active]:bg-bg-surface data-[state=active]:text-text-primary",
        "focus-visible:ring-accent/35 focus-visible:ring-2 focus-visible:outline-none",
      ].join(" ")}
    >
      {label}
    </Tabs.Trigger>
  );
}

function ProfileForm({
  profile,
  refreshProfile,
}: {
  profile: PublisherProfile | null;
  refreshProfile: () => Promise<void>;
}): React.ReactElement {
  const toast = useToast();

  const [draft, setDraft] = useState<PublisherProfile>(profile ?? DEFAULT_PROFILE);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profile) {
      setDraft(profile);
      setDirty(false);
    }
  }, [profile]);

  function update<K extends keyof PublisherProfile>(key: K, value: PublisherProfile[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      await invoke("publisher:save", draft);
      await refreshProfile();
      setDirty(false);
      toast.push("success", "Publisher Profile saved.");
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Section title="Publication basics" subline="Name, default typography, accent color">
        <LabeledInput
          label="Publication name"
          required
          value={draft.publicationName}
          onChange={(v) => update("publicationName", v)}
          placeholder="The Daily Saptahik"
          data-testid="profile-publication-name"
        />

        <LabeledSelect
          label="Typography pairing default"
          value={draft.typographyPairingDefault}
          onChange={(v) => update("typographyPairingDefault", v)}
          options={["Editorial Serif", "News Sans", "Literary", "Modern Geometric"]}
        />

        <LabeledInput
          label="House-style accent color (optional)"
          value={draft.accentColor ?? ""}
          onChange={(v) => update("accentColor", v || null)}
          placeholder="#C96E4E or a CSS color"
        />
      </Section>

      <Section title="Print defaults" subline="Applied to new issues you create">
        <div className="grid grid-cols-2 gap-4">
          <LabeledPills
            label="Default page size"
            value={draft.pageSizeDefault}
            options={["A4", "A5"] as const}
            onChange={(v) => update("pageSizeDefault", v)}
          />
          <LabeledPills
            label="Default language"
            value={draft.primaryLanguageDefault}
            options={["en", "hi", "bilingual"] as Language[]}
            labels={{ en: "English", hi: "Hindi", bilingual: "Bilingual" }}
            onChange={(v) => update("primaryLanguageDefault", v)}
          />
        </div>
        <LabeledSelect
          label="Issue cadence"
          value={draft.issueCadence ?? ""}
          onChange={(v) =>
            update("issueCadence", v ? (v as PublisherProfile["issueCadence"]) : null)
          }
          options={["weekly", "fortnightly", "monthly"]}
          allowEmpty
        />
      </Section>

      <Section
        title="Printer + billing"
        subline="Shown at export time; billing label is for your own bookkeeping"
      >
        <LabeledInput
          label="Printer contact"
          value={draft.printerContact ?? ""}
          onChange={(v) => update("printerContact", v || null)}
          placeholder="email@press.com or phone"
        />
        <LabeledInput
          label="Classifieds billing label"
          value={draft.classifiedsBillingLabel}
          onChange={(v) => update("classifiedsBillingLabel", v)}
          placeholder="Billing Ref / Invoice # / …"
        />
      </Section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-4 py-2 font-semibold disabled:opacity-40"
          data-testid="save-profile-button"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  subline,
  children,
}: {
  title: string;
  subline?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-border-default bg-bg-surface rounded-lg border p-6">
      <h2 className="font-display text-display-md text-text-primary mb-1">{title}</h2>
      {subline ? <p className="text-caption text-text-secondary mb-4">{subline}</p> : null}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

interface LabeledInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  "data-testid"?: string;
}

function LabeledInput(props: LabeledInputProps): React.ReactElement {
  return (
    <label className="block">
      <span className="text-label-caps text-text-secondary mb-1 block">
        {props.label} {props.required ? <span className="text-accent">*</span> : null}
      </span>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        required={props.required}
        data-testid={props["data-testid"]}
        className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2.5 focus:outline-none"
      />
    </label>
  );
}

interface LabeledSelectProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}

function LabeledSelect(props: LabeledSelectProps): React.ReactElement {
  return (
    <label className="block">
      <span className="text-label-caps text-text-secondary mb-1 block">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2.5 focus:outline-none"
      >
        {props.allowEmpty ? <option value="">(none)</option> : null}
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

interface LabeledPillsProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}

function LabeledPills<T extends string>(props: LabeledPillsProps<T>): React.ReactElement {
  return (
    <div>
      <span className="text-label-caps text-text-secondary mb-1 block">{props.label}</span>
      <div className="flex gap-1">
        {props.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => props.onChange(opt)}
            className={[
              "text-title-sm flex-1 rounded-full px-3 py-1.5 transition-colors",
              props.value === opt
                ? "bg-accent text-text-inverse"
                : "text-text-secondary hover:bg-black/[0.04]",
            ].join(" ")}
          >
            {props.labels?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  );
}
