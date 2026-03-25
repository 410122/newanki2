import { CardData, Rating, State, PluginSettings } from "./models";

export interface ScheduleResult {
	card: CardData;
	rating: Rating;
	reviewDatetime: string;
}

export interface IntervalPreview {
	rating: Rating;
	interval: number;
	unit: "minutes" | "days";
	label: string;
}

function deepCopyCard(card: CardData): CardData {
	return JSON.parse(JSON.stringify(card));
}

function getFuzzedInterval(interval: number, maximumInterval: number): number {
	if (interval < 2.5) {
		return interval;
	}

	const FUZZ_RANGES = [
		{ start: 2.5, end: 7.0, factor: 0.15 },
		{ start: 7.0, end: 20.0, factor: 0.1 },
		{ start: 20.0, end: Infinity, factor: 0.05 },
	];

	let delta = 1.0;
	for (const range of FUZZ_RANGES) {
		delta +=
			range.factor *
			Math.max(Math.min(interval, range.end) - range.start, 0.0);
	}

	let minIvl = Math.round(interval - delta);
	let maxIvl = Math.round(interval + delta);

	minIvl = Math.max(2, minIvl);
	maxIvl = Math.min(maxIvl, maximumInterval);
	minIvl = Math.min(minIvl, maxIvl);

	let fuzzed = Math.random() * (maxIvl - minIvl + 1) + minIvl;
	fuzzed = Math.min(Math.round(fuzzed), maximumInterval);

	return fuzzed;
}

function addMinutes(isoDate: string, minutes: number): string {
	const d = new Date(isoDate);
	d.setTime(d.getTime() + minutes * 60 * 1000);
	return d.toISOString();
}

function addDays(isoDate: string, days: number): string {
	const d = new Date(isoDate);
	d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
	return d.toISOString();
}

function daysBetween(a: string, b: string): number {
	const da = new Date(a).getTime();
	const db = new Date(b).getTime();
	return Math.floor((db - da) / (24 * 60 * 60 * 1000));
}

export function reviewCard(
	card: CardData,
	rating: Rating,
	settings: PluginSettings,
	reviewDatetime?: string
): ScheduleResult {
	const updated = deepCopyCard(card);
	const now = reviewDatetime ?? new Date().toISOString();

	if (updated.state === State.Learning) {
		const step = updated.step ?? 0;
		const ls = settings.learningSteps;

		if (ls.length === 0 || step > ls.length) {
			updated.state = State.Review;
			updated.step = null;
			updated.ease = settings.startingEase;
			updated.currentInterval = settings.graduatingInterval;
			updated.due = addDays(now, updated.currentInterval);
		} else {
			if (rating === Rating.Again) {
				updated.step = 0;
				updated.due = addMinutes(now, ls[0]!);
			} else if (rating === Rating.Hard) {
				if (step === 0 && ls.length === 1) {
					updated.due = addMinutes(now, ls[step]! * 1.5);
				} else if (step === 0 && ls.length >= 2) {
					updated.due = addMinutes(now, (ls[step]! + ls[step + 1]!) / 2.0);
				} else {
					updated.due = addMinutes(now, ls[step]!);
				}
			} else if (rating === Rating.Good) {
				if (step + 1 === ls.length) {
					updated.state = State.Review;
					updated.step = null;
					updated.ease = settings.startingEase;
					updated.currentInterval = settings.graduatingInterval;
					updated.due = addDays(now, updated.currentInterval);
				} else {
					updated.step = step + 1;
					updated.due = addMinutes(now, ls[step + 1]!);
				}
			} else if (rating === Rating.Easy) {
				updated.state = State.Review;
				updated.step = null;
				updated.ease = settings.startingEase;
				updated.currentInterval = settings.easyInterval;
				updated.due = addDays(now, updated.currentInterval);
			}
		}
	} else if (updated.state === State.Review) {
		const ease = updated.ease ?? settings.startingEase;
		const ci = updated.currentInterval ?? 1;

		if (rating === Rating.Again) {
			updated.ease = Math.max(1.3, ease * 0.8);
			let newIvl = Math.max(
				settings.minimumInterval,
				Math.round(ci * settings.newInterval * settings.intervalModifier)
			);
			updated.currentInterval = getFuzzedInterval(newIvl, settings.maximumInterval);

			if (settings.relearningSteps.length > 0) {
				updated.state = State.Relearning;
				updated.step = 0;
				updated.due = addMinutes(now, settings.relearningSteps[0]!);
			} else {
				updated.due = addDays(now, updated.currentInterval);
			}
		} else if (rating === Rating.Hard) {
			updated.ease = Math.max(1.3, ease * 0.85);
			let newIvl = Math.min(
				settings.maximumInterval,
				Math.round(ci * settings.hardInterval * settings.intervalModifier)
			);
			updated.currentInterval = getFuzzedInterval(newIvl, settings.maximumInterval);
			updated.due = addDays(now, updated.currentInterval);
		} else if (rating === Rating.Good) {
			const daysOverdue = daysBetween(updated.due, now);
			let newIvl: number;
			if (daysOverdue >= 1) {
				newIvl = Math.min(
					settings.maximumInterval,
					Math.round((ci + daysOverdue / 2.0) * ease * settings.intervalModifier)
				);
			} else {
				newIvl = Math.min(
					settings.maximumInterval,
					Math.round(ci * ease * settings.intervalModifier)
				);
			}
			updated.currentInterval = getFuzzedInterval(newIvl, settings.maximumInterval);
			updated.due = addDays(now, updated.currentInterval);
		} else if (rating === Rating.Easy) {
			const daysOverdue = daysBetween(updated.due, now);
			let newIvl: number;
			if (daysOverdue >= 1) {
				newIvl = Math.min(
					settings.maximumInterval,
					Math.round(
						(ci + daysOverdue) *
						ease *
						settings.easyBonus *
						settings.intervalModifier
					)
				);
			} else {
				newIvl = Math.min(
					settings.maximumInterval,
					Math.round(
						ci * ease * settings.easyBonus * settings.intervalModifier
					)
				);
			}
			updated.currentInterval = getFuzzedInterval(newIvl, settings.maximumInterval);
			updated.ease = ease * 1.15;
			updated.due = addDays(now, updated.currentInterval);
		}
	} else if (updated.state === State.Relearning) {
		const step = updated.step ?? 0;
		const ci = updated.currentInterval ?? 1;
		const ease = updated.ease ?? settings.startingEase;
		const rs = settings.relearningSteps;

		if (rs.length === 0 || step > rs.length) {
			updated.state = State.Review;
			updated.step = null;
			updated.currentInterval = Math.min(
				settings.maximumInterval,
				Math.round(ci * ease * settings.intervalModifier)
			);
			updated.due = addDays(now, updated.currentInterval);
		} else {
			if (rating === Rating.Again) {
				updated.step = 0;
				updated.due = addMinutes(now, rs[0]!);
			} else if (rating === Rating.Hard) {
				if (step === 0 && rs.length === 1) {
					updated.due = addMinutes(now, rs[step]! * 1.5);
				} else if (step === 0 && rs.length >= 2) {
					updated.due = addMinutes(now, (rs[step]! + rs[step + 1]!) / 2.0);
				} else {
					updated.due = addMinutes(now, rs[step]!);
				}
			} else if (rating === Rating.Good) {
				if (step + 1 === rs.length) {
					updated.state = State.Review;
					updated.step = null;
					updated.currentInterval = Math.min(
						settings.maximumInterval,
						Math.round(ci * ease * settings.intervalModifier)
					);
					updated.due = addDays(now, updated.currentInterval);
				} else {
					updated.step = step + 1;
					updated.due = addMinutes(now, rs[step + 1]!);
				}
			} else if (rating === Rating.Easy) {
				updated.state = State.Review;
				updated.step = null;
				updated.currentInterval = Math.min(
					settings.maximumInterval,
					Math.round(
						ci * ease * settings.easyBonus * settings.intervalModifier
					)
				);
				updated.due = addDays(now, updated.currentInterval);
			}
		}
	}

	return { card: updated, rating, reviewDatetime: now };
}

function formatInterval(minutes: number): string {
	if (minutes < 60) {
		return `${Math.round(minutes)}分钟`;
	} else if (minutes < 60 * 24) {
		const hours = Math.round(minutes / 60);
		return `${hours}小时`;
	} else {
		const days = Math.round(minutes / (60 * 24));
		if (days >= 30 && days < 365) {
			const months = Math.round(days / 30);
			return `${months}个月`;
		} else if (days >= 365) {
			const years = (days / 365).toFixed(1);
			return `${years}年`;
		}
		return `${days}天`;
	}
}

export function getNextIntervals(
	card: CardData,
	settings: PluginSettings
): IntervalPreview[] {
	const now = new Date().toISOString();
	const ratings = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

	return ratings.map((rating) => {
		const result = reviewCard(card, rating, settings, now);
		const dueTime = new Date(result.card.due).getTime();
		const nowTime = new Date(now).getTime();
		const diffMinutes = (dueTime - nowTime) / (60 * 1000);

		const label = formatInterval(diffMinutes);
		if (diffMinutes >= 24 * 60) {
			return {
				rating,
				interval: Math.round(diffMinutes / (24 * 60)),
				unit: "days" as const,
				label,
			};
		}
		return {
			rating,
			interval: Math.round(diffMinutes),
			unit: "minutes" as const,
			label,
		};
	});
}
