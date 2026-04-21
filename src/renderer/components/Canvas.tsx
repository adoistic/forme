import React from "react";
import { useNavStore, useShallow } from "../stores/navigation.js";
import { IssueBoardScreen } from "../screens/issue-board/IssueBoardScreen.js";
import { ArticlesScreen } from "../screens/articles/ArticlesScreen.js";
import { ClassifiedsScreen } from "../screens/classifieds/ClassifiedsScreen.js";
import { AdsScreen } from "../screens/ads/AdsScreen.js";
import { SettingsScreen } from "../screens/settings/SettingsScreen.js";
import { EmptyScreen } from "./EmptyScreen.js";

export function Canvas(): React.ReactElement {
  const activeTab = useNavStore(useShallow((s) => s.activeTab));

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {activeTab === "issue-board" && <IssueBoardScreen />}
      {activeTab === "articles" && <ArticlesScreen />}
      {activeTab === "classifieds" && <ClassifiedsScreen />}
      {activeTab === "ads" && <AdsScreen />}
      {activeTab === "images" && (
        <EmptyScreen
          label="IMAGES"
          headline="Image library lands with the photo-essay template."
          subline="For now, embedded images from your .docx files live on disk in the blob store."
        />
      )}
      {activeTab === "templates" && (
        <EmptyScreen
          label="TEMPLATES"
          headline="Template browser."
          subline="The engine ships with Standard Feature A4. Additional templates arrive in Phases 4-10."
        />
      )}
      {activeTab === "history" && (
        <EmptyScreen
          label="HISTORY"
          headline="Snapshot timeline."
          subline="Every edit auto-saves. History UI wires this up in a later phase."
        />
      )}
      {activeTab === "settings" && <SettingsScreen />}
    </main>
  );
}
