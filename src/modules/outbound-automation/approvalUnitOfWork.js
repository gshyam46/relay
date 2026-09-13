import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ActionsRepository } from "./actionsRepository.js";
import { ApprovalsRepository } from "./approvalsRepository.js";
import { ApprovalsService } from "./approvalsService.js";

export function createApprovalUnitOfWork(db) {
  return {
    run(work, { organization_id } = {}) {
      return new ContactPolicyService(db).withWorkspacePolicyTransaction(organization_id, (tx) => work({
        approvalsService: new ApprovalsService({
          actionsRepository: new ActionsRepository(tx),
          approvalsRepository: new ApprovalsRepository(tx),
          auditRepository: new AuditRepository(tx)
        })
      }));
    }
  };
}
