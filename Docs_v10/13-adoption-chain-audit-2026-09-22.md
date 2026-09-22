# Adoption Chain Audit — 2026-09-22

**Status:** AUDITED AND CORRECTED — no Prisma schema change required.

## Scope
Verified the deployment chain from current learner enrollment through school, academic year, term, textbook adoption, textbook identity, and published learner entitlement.

## Locked contract
- Textbook identity = Subject + Grade + PhysicalPart + PrintedEdition.
- TextbookAdoption owns School + AcademicYear + Term deployment context.
- PART_1 maps to term 1; PART_2 maps to term 2.
- BOTH/PB never enters persistence.
- Learner entitlement requires an exact current enrollment match for school, academic year, grade, and term, plus a published textbook.

## Findings
**PASS — learner entitlement.** The learning reader already requires the current enrollment and an adoption matching school + academic year + term, and the textbook grade must match the enrollment grade. Learner-facing reads also require published content.

**PASS — single runtime adoption writer.** Runtime Prisma creation is centralized in PrismaTextbookAdministrationRepository.createAdoption(); the application service is the canonical writer. Seed/load code remains bootstrap.

**GAP — bulk accreditation coordinate validation.** A caller-supplied textbookKey was previously checked only for existence when gradeKey/part were also supplied. This could combine a G07 request with a G08 textbook, or a P1 request with a P2 textbook.

**GAP — term relation validation.** The service previously constructed a term key from a naming convention. The correction resolves the Term row by academicYear relation + ordinal.

## Corrections
1. Added a repository read for textbook grade and physical part.
2. adoptGrade() now refuses grade and physical-part mismatches before writing.
3. Term resolution now queries the selected AcademicYear relation and ordinal.
4. Added focused unit coverage for the three integrity cases.
5. Prisma schema remains unchanged.

## Result
The chain is now explicit:
Textbook identity → TextbookAdoption deployment context → current Enrollment → published textbook → learner entitlement.

**Decision:** keep the schema unchanged and proceed to the next dependency after verification.
