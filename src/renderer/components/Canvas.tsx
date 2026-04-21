import React from "react";
import { useNavStore, useShallow } from "../stores/navigation.js";
import { IssueBoardScreen } from "../screens/issue-board/IssueBoardScreen.js";
import { EmptyScreen } from "./EmptyScreen.js";

export function Canvas(): React.ReactElement {
  const activeTab = useNavStore(useShallow((s) => s.activeTab));

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {activeTab === "issue-board" && <IssueBoardScreen />}
      {activeTab === "articles" && (
        <EmptyScreen
          label="NEW HERE"
          headline="Drop your first article."
          subline="Drag a .docx file here, or import multiple at once."
        />
      )}
      {activeTab === "classifieds" && (
        <EmptyScreen
          label="NO CLASSIFIEDS YET"
          headline="Add your first classified."
          subline="Use the form to enter one, or import a CSV with many at once."
        />
      )}
      {activeTab === "ads" && (
        <EmptyScreen
          label="NO ADS YET"
          headline="Upload your first ad."
          subline="Pick the position, then drop the creative. We'll check the dimensions."
        />
      )}
      {activeTab === "images" && (
        <EmptyScreen
          label="EMPTY LIBRARY"
          headline="Drop photos here."
          subline="Images you import appear here, ready to drag into any article or cover."
        />
      )}
      {activeTab === "templates" && (
        <EmptyScreen
          label="TEMPLATES"
          headline="Template library."
          subline="Coming in Phase 4. For now, templates apply automatically when you place articles."
        />
      )}
      {activeTab === "history" && (
        <EmptyScreen
          label="NO HISTORY YET"
          headline="No saves to restore."
          subline="Every 30 seconds while you edit, Forme saves a snapshot. They show up here."
        />
      )}
      {activeTab === "settings" && (
        <EmptyScreen
          label="SETTINGS"
          headline="Publisher Profile."
          subline="Coming in Phase 8. First-run wizard will land here first."
        />
      )}
    </main>
  );
}
