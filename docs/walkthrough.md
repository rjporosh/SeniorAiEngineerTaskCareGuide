# Walkthrough (about 8 minutes)

1. **Start** — `cp .env.example .env`, replace the `CHANGE_ME` values, `docker compose up --build`. Wait until `docker compose ps` shows everything healthy. Open http://localhost:4001.
2. **Sign in** with the seeded admin. Show that a wrong password gives one clear message and that `/documents` while signed out sends you to sign-in and back.
3. **Upload a mixed batch** from `fixtures/synthetic/`: `digital-01.pdf`, `scanned-01.pdf`, `photo-03.jpg`, `sheet-01.xlsx`, `export-01.csv`, `edge-arithmetic.pdf`, `corrupt.pdf`, plus any `.exe`. Point out: the `.exe` is explained before upload; bytes-sent progress is real; each file then shows its real stage; `corrupt.pdf` is rejected with advice and does not stop the others.
4. **Desk** — the headline counts what is waiting. *Needs review* items carry the red stamp.
5. **Open `edge-arithmetic.pdf`** — the extraction sheet. Click **Show source** on *Invoice number* (highlighted evidence with page). In the margin notes: "Subtotal + tax … does not equal the total". Click **Correct values**, fix the total, save: the note disappears, the history records who/what/why, and the stamp turns to *Reviewed*. Try an invalid value to see every error at once.
6. **Duplicates and cross-checks** — upload `edge-duplicate-a.pdf` and `edge-duplicate-b.pdf` together: both are flagged as possible duplicates (nothing is merged). Upload `sheet-01.xlsx` after its PDF twin to see the PDF↔spreadsheet comparison.
7. **Search** — try an invoice number, a supplier name, and then *Similar meaning*. Results show page or sheet/cell.
8. **Process again** on a document: attempt 2 appears, attempt 1 stays.
9. **Observe** — `docker compose --profile observability up -d`, open Grafana (:3030) and Jaeger (:16686); `docker compose logs api` shows JSON lines with the correlation id.
10. **Switch providers** — set `DATABASE_PROVIDER=mongodb`, `QUEUE_PROVIDER=bullmq`, `docker compose --profile mongodb --profile bullmq up -d --force-recreate api`, repeat step 3. The semantic toggle disappears because MongoDB has no vectors.
11. **Evidence** — `docs/evaluation-report.md`, `docs/performance.md`, and `node scripts/evaluate.mjs --smoke`.
