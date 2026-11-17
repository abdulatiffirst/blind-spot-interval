# Product requirements

The source specification is [SPECIFICATION.md](SPECIFICATION.md). The product reduces reminder management by connecting an ideal memory due date with a feasible study session.

Only topic title is required. Initial knowledge and importance are nullable. Initial knowledge 1/2/unset schedules tomorrow, 3 in two local days, 4 in four, 5 in seven. These are provisional product defaults, not simulated reviews. Default duration is 15 minutes and study hours 09:00–21:00. Importance maps to 85/88/90/93/95% retention, customizable within 80–97%.

Ratings 1 and 2 both map to Again, 3 to Hard, 4 to Good, 5 to Easy. A failed review targets the following local day; lack of availability moves it forward. Calendar changes never advance memory. History survives archive and restore. Manual changes remain protected until reset-auto.

The app has Today, Topics, Calendar and Settings views. The internal calendar remains available without external consent. MVP intentionally excludes AI, payments, uploads and gamification.
