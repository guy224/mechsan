# חיבור Machsan ל־Supabase ופריסה

המדריך הזה מתעד את חיבור היישום הקיים ל־Supabase ואת השלבים שנותרו לפריסה. בפרויקט שלך כבר קיימים הסכמה, הטבלאות, תפקיד ההרצה וההרשאות הבסיסיות. אין להעתיק סיסמאות או מפתחות אמיתיים לריפו.

## לפני שמתחילים

צריך ליצור פרויקט Supabase בעצמך, ולבחור אזור קרוב ככל האפשר לשרת היישום. שמור את סיסמת מסד הנתונים במקום פרטי. אל תשלח אותה בצ'אט ואל תכניס אותה לקוד.

Machsan משתמש בטבלאות ובסיסמאות משלו בתוך PostgreSQL. הוא **לא** משתמש ב־Supabase Auth ולא דורש Supabase service-role key. סכמת היישום `machsan` פרטית ואין להוסיף אותה ל־Exposed schemas.

## הכנת מסד הנתונים

1. בלוח Supabase פתח את `Connect` והעתק כתובת PostgreSQL. בחר **Direct** אם הרשת של שרת היישום תומכת IPv6, או **Session pooler** אם דרושה תמיכת IPv4. אל תבחר **Transaction pooler**: היישום משתמש ב־`LISTEN/NOTIFY` לחיווי בזמן אמת, וחיבור זה אינו מתאים למצב transaction pooling.
2. הורד מלוח Supabase את תעודת ה־root CA ושמור אותה כקובץ סודי בשרת (לא בריפו). היישום מאמת TLS ומקבל את נתיב התעודה דרך `DATABASE_SSL_ROOT_CERT`.
3. הגדר זמנית `DATABASE_URL` של בעל המסד/המשתמש הראשי בסביבת היישום, והפעל פעם אחת `npm run migrate`. פעולה זו יוצרת את הסכמה והטבלאות.
4. צור משתמש נפרד להרצה. אפשר ליצור סיסמה בטוחה עם `openssl rand -hex 32`. בלוח SQL של Supabase החלף את `PASTE_GENERATED_HEX_PASSWORD` בסיסמה שיצרת והריץ:

```sql
CREATE ROLE machsan_app LOGIN PASSWORD 'PASTE_GENERATED_HEX_PASSWORD'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE postgres TO machsan_app;
```

5. כמשתמש בעל ההרשאות, הרץ את הקובץ `db/runtime-role.sql`. הוא מעניק ליישום רק הרשאות שימוש שוטף ומונע שינוי של יומן הביקורת והיסטוריית המלאי.
6. שנה את `DATABASE_URL` של האתר ושל ה־worker לחיבור של `machsan_app`. בפרטי החיבור של Supabase הוסף לשם המשתמש את מזהה הפרויקט אם ה־Session pooler דורש זאת. אל תוסיף `sslmode` לכתובת; TLS מוגדר בנפרד.

המשתנים הדרושים:

```dotenv
DATABASE_URL=postgresql://... # חיבור PostgreSQL של machsan_app
DATABASE_SSL_ROOT_CERT=/נתיב/מאובטח/supabase-root.crt
NEXTAUTH_URL=https://הכתובת-שלך
NEXTAUTH_SECRET=סוד-אקראי-ארוך
```

צור `NEXTAUTH_SECRET` בעזרת `openssl rand -base64 32`. בפיתוח מקומי `NEXTAUTH_URL` הוא `http://localhost:3000`; בייצור הוא חייב להיות כתובת HTTPS האמיתית. שמור את כל המשתנים במנהל הסודות של ספק האירוח, לא בקוד או בדפדפן.

## יצירת מנהל ראשוני

הגדר זמנית `ADMIN_NAME`, `ADMIN_PHONE` ו־`ADMIN_PASSWORD` (לפחות 12 תווים) בסביבת היישום, והריץ `npm run bootstrap` פעם אחת. לאחר שנוצר המשתמש, מחק את שלושת המשתנים מסביבת הייצור. שחזור חשבון נעשה בידי מנהל לאחר אימות זהות מחוץ ליישום; אין אימות בעלות אוטומטי על מספר הטלפון או שליחת SMS.

## הרצה מקומית

```sh
npm ci
cp .env.example .env
# ערוך את .env עם חיבור מסד מקומי או סביבת בדיקה, ולא עם פרטי ייצור
npm run migrate
npm run bootstrap
# חלון מסוף ראשון:
npm run worker
# חלון מסוף שני:
npm run dev
```

פתח `http://localhost:3000`. ה־worker חייב לפעול בחלון משלו. אל תריץ את bootstrap מול מסד אמיתי שבו כבר יש מנהל.

## אירוח מומלץ

לגרסה אמיתית צריך שירות Node.js לאתר ושירות **Background Worker** נפרד, שניהם עם אותם משתני שרת ועם הפעלה אוטומטית מחדש. ב־Render אפשר להגדיר Web Service שמריץ `npm start` ושירות Background Worker שמריץ `npm run worker`; חבר אותם לאותו מאגר קוד ולאותו אזור שבו נמצא Supabase. הגדר דומיין HTTPS, health check ל־`/api/health`, שמירת לוגים וגיבוי מסד.

אל תשתמש בתוכנית חינמית לתפעול מחסן: שירותי Web בחינם עשויים להירדם, ותוכנית חינמית אינה מספקת worker רציף. Supabase Free עלול להיעצר לאחר תקופה ללא פעילות. לפני רכישה, בדוק את המחיר העדכני ואת הגדרות הגיבוי אצל הספקים. שום שירות בתשלום לא נוצר במסגרת העבודה הזו.

## בדיקות לפני פתיחה למדריכים

1. בסביבת PostgreSQL זמנית ונפרדת, הרץ את בדיקות native concurrency לפי `README.md`. הבדיקה מוחקת ויוצרת מחדש רק את הסכמה `machsan` במסד ששמו `machsan_test`.
2. בצע תרחיש HTTP מלא בסביבת staging עם חשבונות ומלאי בדויים, והשאר שני תהליכי worker פעילים כדי לבדוק התאוששות ותחרות ביניהם.
3. בדוק התקנה וסריקה פיזית ב־Safari באייפון וב־Chrome באנדרואיד דרך HTTPS, כולל מתן הרשאת מצלמה וביטולה.
4. אמת גיבוי ושחזור, התרעות worker, ועומס של כ־300 משתמשים לפני פתיחת רישום אמיתית.

בדיקות אלה מול שירותים וטלפונים אמיתיים עדיין לא בוצעו. אין להשתמש במלאי או בפרטי משתמשים אמיתיים עד להשלמתן.
