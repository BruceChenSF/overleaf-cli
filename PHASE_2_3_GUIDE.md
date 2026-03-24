# Phase 2 & 3 Execution Guide for New Session

## Current Status

✅ **Phase 1 Completed** - All 5 foundation tasks implemented and 34 tests passing

📋 **Ready to Execute** - Phase 2 (Dropdown UI) and Phase 3 (File Sync) detailed tasks ready

## How to Continue in New Session

### Step 1: Reference the Complete Plan

The complete implementation plan with Phase 2 and 3 tasks is in:
```
docs/plans/2025-03-05-bidirectional-sync-implementation-full.md
```

This file contains ALL code, tests, and steps for Tasks 6-9.

### Step 2: Execute Task 6 - Dropdown Component

Tell the new session:

```
Please execute Task 6 from the implementation plan:

Task 6: Create Dropdown Menu Component

Files to create:
- src/content/dropdown.ts
- src/styles/dropdown.css
- tests/unit/dropdown.test.ts

Use the complete code and tests from:
docs/plans/2025-03-05-bidirectional-sync-implementation-full.md

Follow the TDD workflow:
1. Write tests (Step 1)
2. Verify tests fail
3. Implement Dropdown class (Step 3)
4. Create styles (Step 4)
5. Run tests to verify pass
6. Commit
```

### Step 3: Execute Task 7 - Integrate Dropdown

```
Please execute Task 7 from the implementation plan:

Task 7: Integrate Dropdown with Injector

Modify: src/content/injector.ts

See the complete code changes in:
docs/plans/2025-03-05-bidirectional-sync-implementation-full.md

Steps:
1. Update injector.ts with new code
2. Run build to verify
3. Test in browser
4. Commit
```

### Step 4: Execute Task 8 - Sync Manager

```
Please execute Task 8 from the implementation plan:

Task 8: Implement Sync Manager

Files to create:
- src/content/sync-manager.ts
- tests/unit/sync-manager.test.ts

See complete code in:
docs/plans/2025-03-05-bidirectional-sync-implementation-full.md

Steps:
1. Write tests
2. Implement SyncManager class
3. Run tests
4. Commit
```

### Step 5: Execute Task 9 - Integrate Sync Manager

```
Please execute Task 9 from the implementation plan:

Task 9: Integrate Sync Manager with Content Script

Modify: src/content/injector.ts

See complete code in:
docs/plans/2025-03-05-bidirectional-sync-implementation-full.md

Steps:
1. Add sync manager integration
2. Test full system
3. Commit
```

## Quick Reference for New Session

**All detailed code is in:**
- `docs/plans/2025-03-05-bidirectional-sync-implementation-full.md`

**Task Summary:**
- Task 6: Dropdown component (3 files)
- Task 7: Dropdown integration (1 file)
- Task 8: Sync manager (2 files)
- Task 9: Sync integration (1 file)

**Total remaining work:** 4 tasks, ~7 files, ~30 tests

**Expected time:** Each task 30-60 minutes

## Design Reference

For design context, refer to:
- `docs/plans/2025-03-05-bidirectional-sync-design.md` - Full system design
- `docs/DESIGN.md` - Design documentation
- `README.md` - Project overview

## Checkpoints

After each task, verify:
- ✅ All tests pass
- ✅ Build succeeds
- ✅ No TypeScript errors
- ✅ Changes committed

## Support

This session remains available for:
- Answering design questions
- Clarifying implementation details
- Troubleshooting issues
- Adjusting the plan if needed

---

**Ready to continue! Start with Task 6 in your new session.**
