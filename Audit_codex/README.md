# Audit_codex

هذه الأداة هي بوابة feedback قبل الاستمرار في تعديلات Codex/ChatGPT.

## التشغيل المعتاد

من جذر المشروع:

    cd ~/edu_v10
    python Audit_codex/audit_commit_changes.py

في الوضع الافتراضي لا يتم أخذ HEAD~1 بشكل أعمى.

الأداة تبحث من HEAD إلى الخلف عن آخر commit غيّر ملفات المشروع خارج Audit_codex/report/، ثم تقارن ذلك الـcommit مع أول parent مباشر له.

لذلك إذا تم حفظ تقرير جديد في commit لاحق، فلن يصبح ذلك التقرير هو التغيير الجديد الذي يتم تدقيقه.

## ملف feedback

يتم حفظ آخر تقرير في:

    Audit_codex/report/latest_commit_feedback.txt

يتم استبدال الملف عند كل تشغيل، ويحتوي على:

- commit الذي يمثل آخر تغيير فعلي في المشروع.
- الـparent الذي تمت المقارنة معه.
- عدد الأسطر القديمة والجديدة.
- إجمالي + و -.
- الملفات التي أضيفت أو حُذفت أو عُدلت.
- الدوال التي يُحتمل أنها حُذفت.
- الدوال التي يُحتمل أنها أضيفت.
- DECISION SIGNAL.
- تعليمات واضحة للنموذج حول ما إذا كان التقرير هو feedback المعتمد للتغيير الأخير.

## قاعدة مهمة للنموذج

عند التشغيل بدون معاملات، Audit_codex/report/latest_commit_feedback.txt هو feedback الخاص بآخر commit فعلي للمشروع، ويمكن استخدامه لاتخاذ قرار هل يجب الاستمرار أم التوقف للمراجعة.

أما عند تمرير commitين يدوياً:

    python Audit_codex/audit_commit_changes.py <old-commit> <new-commit>

فإن التقرير يصنف نفسه HISTORICAL_ONLY، ومعناه أن هذه مقارنة تاريخية مطلوبة صراحة، ولا يجوز استخدامها كمصدر القرار الخاص بآخر تغيير في المشروع.

## إشارات القرار

- LOW_RISK_SIGNAL: لا توجد أسطر محذوفة على مستوى النص؛ هذا ليس إثباتاً لصحة التنفيذ.
- REVIEW_REQUIRED: توجد عمليات حذف أو اختفاء محتمل لدوال؛ يجب فحص diff قبل متابعة التغيير التالي.
- HISTORICAL_ONLY: مقارنة تاريخية؛ لا تستخدم لاتخاذ قرار بشأن آخر تغيير.
- NO_CHANGE: لا توجد تغييرات نصية.

## مثال workflow

1. دع Codex/ChatGPT ينفذ التغيير.
2. تأكد من إنشاء commit للتغيير.
3. شغّل:

    python Audit_codex/audit_commit_changes.py

4. افتح:

    Audit_codex/report/latest_commit_feedback.txt

5. إذا ظهر REVIEW_REQUIRED، توقف وافحص diff والدوال المتأثرة قبل إعطاء النموذج مهمة جديدة.
6. بعد قبول التغيير، شغّل build/tests المناسبة للمشروع.

## ملاحظة

الأداة Guardrail وليست إثباتاً للصحة. كشف حذف الدوال يعتمد حالياً على signatures بسيطة لـ TypeScript/JavaScript/Python، وقد تحتاج عمليات rename/move أو declarations متعددة الأسطر أو التغييرات الدلالية إلى مراجعة واختبارات إضافية.
