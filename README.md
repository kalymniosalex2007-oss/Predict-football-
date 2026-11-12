# GoalPredict Platform (ποδόσφαιρο, μπάσκετ, Premium μέσω Stripe)

## Αρχιτεκτονική
| Κομμάτι | Τεχνολογία | Ρόλος |
|---|---|---|
| Δημόσιο site | GitHub Pages (στατικές σελίδες) | Αγώνες, αναλύσεις, ιστορικό, νομικά. Άριστο SEO και ταχύτητα |
| Παραγωγή δεδομένων | GitHub Actions (κάθε 15 λεπτά) | Παίρνει δεδομένα από API-Football και API-Basketball, τρέχει το μοντέλο, χτίζει τις σελίδες |
| Βάση, χρήστες, δικαιώματα | Supabase (Postgres + Auth + RLS) | Λογαριασμοί, συνδρομές, ledger προγνωστικών, μηνύματα, χρήση API |
| Πληρωμές | Stripe Checkout + Customer Portal | Συνδρομές, ακυρώσεις, αποδείξεις |
| Ασφαλής λογική | Supabase Edge Functions | Δημιουργία πληρωμής και webhook του Stripe (τα μυστικά του Stripe μένουν μόνο εδώ) |

**Πώς προστατεύεται το Premium:** τα Premium προγνωστικά ΔΕΝ γράφονται ποτέ στο δημόσιο HTML ή στο repo. Αποθηκεύονται μόνο στη βάση και ο κανόνας RLS `picks_read` τα δίνει μόνο σε ενεργούς συνδρομητές (ή admin) μέχρι την έναρξη του αγώνα. Ένας δωρεάν χρήστης δεν μπορεί να τα πάρει ούτε μέσω του API της βάσης. Μετά την έναρξη του αγώνα γίνονται δημόσια και μπαίνουν στο ιστορικό.

**Αμετάβλητο ιστορικό:** ένας trigger της βάσης (`picks_guard`) απαγορεύει σε όλους, ακόμη και στον admin και στο service key, να αλλάξουν ή να διαγράψουν προγνωστικό μετά την έναρξη του αγώνα. Επιτρέπεται μόνο η καταχώρηση αποτελέσματος.

**Αυτόματη λήξη:** η πρόσβαση ελέγχεται σε κάθε ανάγνωση (`status` ενεργό ΚΑΙ `current_period_end` στο μέλλον). Ακόμα κι αν ένα webhook καθυστερήσει, η πρόσβαση κόβεται μόλις περάσει η ημερομηνία λήξης.

## Πού μένει κάθε κλειδί (τίποτα δεν μπαίνει σε αρχείο του repo)
| Κλειδί | Πού μπαίνει | Ορατό σε επισκέπτες; |
|---|---|---|
| API_FOOTBALL_KEY, API_BASKETBALL_KEY (προαιρετικά), ANTHROPIC_API_KEY | GitHub → Settings → Secrets → Actions → **Secrets** | Όχι |
| SUPABASE_SERVICE_KEY (service_role) | GitHub **Secrets** | Όχι |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs | Supabase → Edge Functions → **Secrets** | Όχι |
| SUPABASE_URL, SUPABASE_ANON_KEY | GitHub → Actions → **Variables** | Ναι, εξ ορισμού (το anon key είναι δημόσιο· η προστασία γίνεται από τα RLS) |

## Εγκατάσταση (με τη σειρά) · Προτείνεται υπολογιστής
### 1. GitHub
Ανέβασε όλα τα περιεχόμενα του φακέλου `platform` σε **public** repo (π.χ. `Predict-football`), αντικαθιστώντας τα παλιά αρχεία. Στον υπολογιστή, με σύρσιμο φακέλων, διατηρούνται οι φάκελοι. Settings → Pages → Source: **GitHub Actions**. Settings → Actions → General → Workflow permissions: **Read and write**.

### 2. Supabase (supabase.com)
1. New project, περιοχή **Frankfurt (eu-central-1)**. Κράτα τον κωδικό της βάσης.
2. SQL Editor → επικόλλησε ΟΛΟ το `supabase/schema.sql` → Run.
3. Authentication → URL Configuration: **Site URL** = η διεύθυνση του site (`https://ΟΝΟΜΑ.github.io/ΟΝΟΜΑ-REPO`) και στα **Redirect URLs** πρόσθεσε `https://ΟΝΟΜΑ.github.io/ΟΝΟΜΑ-REPO/**`.
4. Project Settings → API: αντέγραψε το **Project URL**, το **anon public** key και το **service_role** key.
5. Authentication → SMTP: ο προεπιλεγμένος αποστολέας email του Supabase έχει πολύ χαμηλό όριο και δεν κάνει για παραγωγή. Σύνδεσε δικό σου SMTP (π.χ. Resend, Brevo).

### 3. Μεταβλητές GitHub
- **Secrets:** `API_FOOTBALL_KEY`, `SUPABASE_SERVICE_KEY` (και προαιρετικά `API_BASKETBALL_KEY`, `ANTHROPIC_API_KEY`).
- **Variables:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Το API-Basketball: ο λογαριασμός api-sports.io σού επιτρέπει να ενεργοποιήσεις και το δωρεάν πλάνο του API-Basketball (ξεχωριστό όριο κλήσεων). Αν ο ίδιος κωδικός δεν γίνεται δεκτός, βάλε το κλειδί του στο `API_BASKETBALL_KEY`.

### 4. Stripe (dashboard.stripe.com), πρώτα σε **Test mode**
1. Products → φτιάξε προϊόν «Premium» με 2 τιμές (Recurring): μηνιαία και ετήσια. Κράτα τα `price_...`.
2. Settings → Billing → **Customer portal** → ενεργοποίησε το (ακύρωση συνδρομής, αλλαγή κάρτας).
3. Έλεγξε στους όρους του Stripe ότι η υπηρεσία προγνωστικών επιτρέπεται. Αν όχι, βρες άλλον πάροχο πριν προχωρήσεις (δες «Ρίσκα»).

### 5. Edge Functions
Με το Supabase CLI (`npm i -g supabase`, `supabase login`, `supabase link --project-ref ΚΩΔΙΚΟΣ`):
```
supabase functions deploy create-checkout
supabase functions deploy customer-portal
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set SITE_URL=https://ΟΝΟΜΑ.github.io/ΟΝΟΜΑ-REPO STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_YEARLY=price_...
```
Το `--no-verify-jwt` ΜΟΝΟ στο webhook (το Stripe δεν στέλνει JWT· ασφαλίζεται με επαλήθευση υπογραφής).
Μετά, στο Stripe → Developers → **Webhooks → Add endpoint**: URL `https://ΚΩΔΙΚΟΣ.supabase.co/functions/v1/stripe-webhook`, γεγονότα: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Αντέγραψε το **Signing secret** και τρέξε `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.
(Προαιρετικά `STRIPE_AUTOMATIC_TAX=true` αν έχεις ρυθμίσει το Stripe Tax.)

### 6. Στοιχεία του site
Συμπλήρωσε το `data/site.json`: επωνυμία/διεύθυνση/ΑΦΜ του υπευθύνου, email επικοινωνίας, ετικέτες τιμών (οι πραγματικές τιμές ορίζονται στο Stripe) και τι περιλαμβάνει το Premium. Έτσι συμπληρώνονται οι Όροι και η Πολιτική απορρήτου.

### 7. Πρώτη εκτέλεση και admin
1. Actions → «Update and publish» → Run workflow.
2. Κάνε εγγραφή στο site (`/login/`), επιβεβαίωσε το email και μετά στο Supabase SQL Editor τρέξε: `update public.profiles set is_admin = true where email = 'το-email-σου';`
3. Μπες στο `/admin/`.

## Έλεγχος σε Test mode (κάν' τον πριν πάρεις χρήματα)
1. Εγγραφή → Premium → Συνδρομή → κάρτα δοκιμής `4242 4242 4242 4242` (οποιαδήποτε μελλοντική λήξη/CVC). Στο `/account/` η κατάσταση γίνεται «Ενεργό» μέσα σε λίγα δευτερόλεπτα.
2. Στο Stripe → Webhooks, δες ότι οι παραδόσεις έχουν απάντηση 200.
3. Ακύρωση από το «Διαχείριση συνδρομής»: η πρόσβαση συνεχίζεται μέχρι τη λήξη της περιόδου και μετά κόβεται.
4. Έλεγχος ότι ο δωρεάν χρήστης δεν βλέπει Premium: στον ίδιο τον browser, δεν υπάρχει premium pick στο HTML. Και απευθείας στο API: `curl "$SUPABASE_URL/rest/v1/picks?tier=eq.premium&select=label" -H "apikey: $ANON_KEY"` πρέπει να επιστρέφει μόνο προγνωστικά αγώνων που έχουν ήδη ξεκινήσει.
5. Μόνο όταν όλα δουλεύουν, πέρασε σε Live mode (νέα live κλειδιά και νέο webhook).

## Τι περιλαμβάνει
- **Σελίδες:** αρχική (σημερινά, επιλεγμένοι αγώνες, LIVE, πρόσφατα αποτελέσματα, δημοφιλή πρωταθλήματα, αναλύσεις, Premium κλειδωμένο), `/football/`, `/basketball/`, ημερολόγιο και βελάκια ημερών (-60 έως +30), κατάλογος όλων των διοργανώσεων με αναζήτηση/χώρα/τύπο και επιλογή πολλών (`/football/leagues/`), σελίδα ανά διοργάνωση με βαθμολογία, σελίδα ανά αγώνα, `/history/`, `/premium/`, `/account/`, `/login/`, `/admin/`, επικοινωνία, όροι χρήσης, απορρήτου, cookies, όροι συνδρομών, υπεύθυνο παιχνίδι.
- **Κατάλογος διοργανώσεων:** φορτώνεται από το API (1 κλήση την εβδομάδα) και δεν εξαρτάται από το πρόγραμμα της ημέρας.
- **Ιστορικό:** φίλτρα άθλημα/κατηγορία/ημερομηνίες, ποσοστό επιτυχίας και yield. Το yield υπολογίζεται μόνο για προγνωστικά με γνωστή απόδοση (μέσος όρος bookmakers τη στιγμή της δημοσίευσης).
- **Admin:** επισκόπηση (χρήστες, ενεργοί συνδρομητές, πληρωμές 30 ημερών), προγνωστικά (προσθήκη, επεξεργασία, προγραμματισμός δημοσίευσης, δωρεάν/Premium, καταχώρηση αποτελέσματος), χρήστες (δωρεάν πρόσβαση ημερών), πληρωμές/συνδρομές, μηνύματα, χρήση API και αίτημα ανανέωσης.
- **Cache:** διοργανώσεις (7 ημέρες), βαθμολογίες (12 ώρες), φόρμα και H2H μπάσκετ, στη βάση. Όριο και χρήση API καταγράφονται ανά ημέρα.

## Όρια και ρίσκα
- **Δωρεάν API:** το πλάνο επιτρέπει δεδομένα μόνο για χθες, σήμερα και αύριο (το σφάλμα του API το λέει ρητά, και η σελίδα το εμφανίζει). Για περισσότερες ημέρες απαιτείται πληρωμένο πλάνο, και το σύστημα το αξιοποιεί αυτόματα χωρίς αλλαγή κώδικα (μέσω `DAYS_AHEAD`). Ιστορικό αγώνων υπάρχει μόνο από τη στιγμή που ξεκίνησε η λειτουργία.
- **LIVE:** ανανέωση κάθε ~15 λεπτά, όχι δευτερόλεπτο-προς-δευτερόλεπτο.
- **Παίκτες/στατιστικά παικτών μπάσκετ:** δεν έχουν υλοποιηθεί.
- **Στατιστικά επισκεψιμότητας:** δεν τα παρέχει το GitHub Pages.
- **Spam:** η φόρμα επικοινωνίας γράφει απευθείας στη βάση με απλό honeypot. Αν δεχτείς spam, πρόσθεσε Cloudflare Turnstile.
- **Πάροχος πληρωμών:** το Stripe μπορεί να περιορίζει υπηρεσίες σχετικές με στοιχήματα. Έλεγξε τους όρους πριν ξεκινήσεις· ο λογαριασμός μπορεί να κλείσει.
- **Νομικά/φορολογικά:** οι όροι χρήσης, απορρήτου και συνδρομών είναι πρότυπα και ΔΕΝ αποτελούν νομική συμβουλή. Χρειάζονται έλεγχο από δικηγόρο, ειδικά για διαφήμιση ή πώληση στοιχηματικών προγνωστικών στην Ελλάδα, ΦΠΑ και τιμολόγηση, και GDPR.
- **Supabase free:** τα δωρεάν projects μπορεί να παγώνουν χωρίς δραστηριότητα· οι εκτελέσεις κάθε 15 λεπτά κρατούν το project ενεργό. Δες τα τρέχοντα όρια/τιμές στο supabase.com.
- **GitHub:** τα προγραμματισμένα workflows μπορεί να καθυστερούν, και σε repo χωρίς δραστηριότητα 60 ημερών απενεργοποιούνται (τα commits δεδομένων μετράνε ως δραστηριότητα).

## Επέκταση σε νέα αθλήματα/λειτουργίες
Κάθε άθλημα είναι ένα module (δες `lib/basketball.js`): `sync` (αγώνες), `enrich` (ανάλυση), μοντέλο, `registerSettler` (έλεγχος αποτελέσματος) και προσαρμογέας για τις σελίδες (`adaptBb` στο `lib/pages.js`). Το ledger (`picks`) είναι ενιαίο με στήλη `sport`, άρα νέο άθλημα ή νέο πλάνο προστίθεται χωρίς αλλαγή της βάσης. Τα επίπεδα πρόσβασης (`tier`) μπορούν να επεκταθούν με νέες τιμές και αντίστοιχους κανόνες RLS.
