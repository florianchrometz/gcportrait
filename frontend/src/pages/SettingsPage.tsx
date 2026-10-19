// SPDX-License-Identifier: Apache-2.0
import { DemoEntry } from '../snapshots/DemoEntry';
import { useAppState } from '../state';
import { usePreference } from '../storage/preferences';
import { THEME_PREFERENCE_LABELS, THEME_PREFERENCES, type ThemePreference } from '../theme/theme';
import { useTheme } from '../theme/useTheme';
import page from './Page.module.css';
import styles from './SettingsPage.module.css';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * The licence texts the build ships next to the app (frontend/vite.config.ts): gcportrait's own licence, and the
 * notices of the third-party software in the app and the server (scripts/third-party-notices.mjs).
 * Every instance serves them from its own origin.
 */
export const LICENCE_LINKS = {
  licence: `${import.meta.env.BASE_URL}licenses/gcportrait-LICENSE.txt`,
  thirdParty: `${import.meta.env.BASE_URL}licenses/THIRD_PARTY_NOTICES.txt`,
} as const;

const THEME_HINTS: Readonly<Record<ThemePreference, string>> = {
  system: 'Follow the light or dark setting of this device.',
  light: 'Light surfaces and dark text.',
  dark: 'Dark surfaces and light text.',
};

/**
 * Settings, saved in this browser: the theme (system, light, dark), what the diagram canvas shows, the synthetic
 * demo organisations when not signed in, and the licences, linked.
 */
export function SettingsPage() {
  useDocumentTitle('Settings');
  const { preference, setPreference } = useTheme();
  const [overlays, setOverlays] = usePreference('diagramOverlays', true);
  const sessionStatus = useAppState((state) => state.connect.session.status);

  return (
    <div className={page.page}>
      <div className={page.intro}>
        <h1 className={page.title}>Settings</h1>
        <p className={page.lead}>Settings are saved in this browser only.</p>
      </div>
      <section className={page.section} aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className={page.sectionTitle}>
          Appearance
        </h2>
        <fieldset className={styles.choices}>
          <legend className={styles.legend}>Theme</legend>
          {THEME_PREFERENCES.map((option) => (
            <div key={option} className={styles.choice}>
              <label className={styles.choiceLabel}>
                <input
                  type="radio"
                  name="theme"
                  value={option}
                  checked={preference === option}
                  onChange={() => {
                    setPreference(option);
                  }}
                  aria-describedby={`theme-hint-${option}`}
                />
                {THEME_PREFERENCE_LABELS[option]}
              </label>
              <span id={`theme-hint-${option}`} className={styles.choiceHint}>
                {THEME_HINTS[option]}
              </span>
            </div>
          ))}
        </fieldset>
      </section>
      <section className={page.section} aria-labelledby="settings-diagram">
        <h2 id="settings-diagram" className={page.sectionTitle}>
          Diagram
        </h2>
        <div className={styles.choice}>
          <label className={styles.choiceLabel}>
            <input
              type="checkbox"
              checked={overlays}
              onChange={(event) => {
                setOverlays(event.target.checked);
              }}
              aria-describedby="diagram-overlays-hint"
            />
            Show the legend and the title block on the canvas
          </label>
          <span id="diagram-overlays-hint" className={styles.choiceHint}>
            Exported diagrams always include them.
          </span>
        </div>
      </section>
      {sessionStatus === 'signed-in' ? null : (
        <section className={page.section} aria-labelledby="settings-demo">
          <h2 id="settings-demo" className={page.sectionTitle}>
            Demo organisations
          </h2>
          <p className={page.note}>
            Explore synthetic organisations of different sizes. No Google account and no backend needed.
          </p>
          <DemoEntry action="Try the demo" />
        </section>
      )}
      <section className={page.section} aria-labelledby="settings-licences">
        <h2 id="settings-licences" className={page.sectionTitle}>
          Licences
        </h2>
        <p className={page.note}>
          gcportrait is open source under the Apache License 2.0: its{' '}
          <a href={LICENCE_LINKS.licence}>licence</a>. The gcportrait name and icon are not covered by it.
        </p>
        <p className={page.note}>
          The app and its server include third-party software under its own licences; the{' '}
          <a href={LICENCE_LINKS.thirdParty}>third-party notices</a> list every package with its copyright and
          licence text.
        </p>
      </section>
    </div>
  );
}
