# بوصلة التطبيقات — ابنِ تطبيقك بوصف واحد

منصة ويب عربية (RTL) مصممة بأسلوب تطبيقات الهاتف الأصلية لتحويل وصف فكرة تطبيق مكتوب بالعربية إلى تطبيق أندرويد حقيقي جاهز للتنزيل بصيغة **APK**.

## المكونات المضمنة
- **تطبيق الويب (`/`)**: شاشة البداية، تسجيل الدخول وإنشاء الحساب مع تفعيل البريد الإلزامي، استعادة كلمة المرور، البوت الذكي، المحفظة (`BOS-XXXX`)، شحن النقاط عبر بنكك/ساهل/ماي كاشي مع واتساب، قائمة تطبيقاتي، والإعدادات.
- **لوحة الإدارة (`/admin`)**: دخول خاص للمشرفين، البحث في المحافظ، شحن/خصم النقاط، مراجعة طلبات الشحن، سجل المعاملات الكامل، وإعدادات التسعير.
- **دوال Supabase (`supabase/`)**: مخطط قاعدة البيانات `schema.sql` مع RLS وRPCs، ودالتا `chat` و `start-build`.
- **سير عمل البناء (`.github/workflows/build-web.yml`)**: للتحقق التلقائي من بناء تطبيق الويب.

## خطوات التشغيل والإعداد

1. **نسخ ملف البيئة**:
   ```bash
   cp .env.example .env
   ```

2. **إعداد Supabase**:
   - أنشئ مشروعاً في Supabase وشغّل محتوى `supabase/schema.sql` داخل SQL Editor.
   - فعّل تأكيد البريد الإلكتروني في **Authentication > Providers > Email** وأضف مسارات التوجيه:
     - `https://your-domain.com/verified`
     - `https://your-domain.com/reset-password`
   - ضع `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` في ملف `.env`.
   - انشر دوال `supabase/functions/chat` و `supabase/functions/start-build` وأضف `GEMINI_API_KEY` و `GITHUB_TOKEN` و `BOSLA_TEMPLATE_REPO` في أسرار Supabase.

3. **تثبيت الحزم والتشغيل**:
   ```bash
   npm install
   npm run dev
   ```

4. **بناء نسخة الإنتاج**:
   ```bash
   npm run build
   ```
