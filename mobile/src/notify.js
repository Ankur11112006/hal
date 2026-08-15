// Vaccination reminders. SPEC.md B2, the highest impact-to-effort feature in
// the app: the vaccine is free and the government administers it, so cost is
// not the barrier. Knowing the due date is. One date per animal and a
// scheduled notification. No sensors, no logging, no ML.
//
// Reminders are scheduled from the LOCAL due dates, so they still fire with the
// phone offline. The server cron in the backend is for users who reinstall.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { dueVaccines } from './db';
import { t, L } from './content';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: true, shouldSetBadge: false,
  }),
});

export async function setup() {
  const { status } = await Notifications.getPermissionsAsync();
  let granted = status === 'granted';
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
  }
  if (granted && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('vaccine', {
      name: t('notify.channel'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  return granted;
}

/**
 * Rebuild the whole schedule. Cheap (a handful of rows) and idempotent, so it
 * runs on every launch and after any vaccination is recorded, rather than
 * trying to diff what is already queued.
 */
export async function syncReminders(farmerId) {
  if (!(await setup())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const due = await dueVaccines(farmerId);
  const now = Date.now();
  let n = 0;

  for (const v of due) {
    const name = L(v.data.label) || v.data.vaccine;
    // Fire a week ahead, and again on the day. An overdue one is surfaced at
    // the next 9am rather than silently dropped.
    const dueAt = new Date(v.at).getTime();
    const targets = v.overdue
      ? [nextMorning()]
      : [dueAt - 7 * 86400000, dueAt].filter((ms) => ms > now).map(atNineAm);

    for (const when of targets) {
      if (when <= now) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${v.animal_name} · ${name}`,
          // Blueprint D2: what / when / why, never a bare fact.
          body: v.overdue
            ? `${t('vaccine.overdue', { days: Math.abs(v.daysLeft) })}. ${t('vaccine.free')}.`
            : `${t('vaccine.due', { days: Math.round((when - now) / 86400000) })}. ${t('vaccine.free')}.`,
          data: { animal_id: v.animal_id, vaccine: v.data.vaccine },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when) },
      });
      n++;
    }
  }
  return n;
}

// Rural reality: a 3am notification is a notification that gets turned off.
function atNineAm(ms) {
  const d = new Date(ms);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function nextMorning() {
  const d = new Date();
  if (d.getHours() >= 9) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
