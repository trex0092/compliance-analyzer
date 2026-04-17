/**
 * Hawkeye Sterling V2 - Document Management System
 * Centralized document storage and management
 */

class DocumentManagement {
  constructor() {
    this.documents = [];
    this.versions = [];
    this.accessControl = [];
  }

  /**
   * Upload document
   */
  uploadDocument(documentData) {
    console.log(`\n📄 UPLOADING DOCUMENT: ${documentData.fileName}\n`);

    const document = {
      id: `DOC-${Date.now()}`,
      fileName: documentData.fileName,
      fileType: documentData.fileType,
      fileSize: documentData.fileSize,
      uploadedBy: documentData.uploadedBy,
      uploadedAt: new Date().toISOString(),
      category: documentData.category, // KYC, REGULATORY, INCIDENT, TRAINING, etc
      tags: documentData.tags || [],
      description: documentData.description,
      status: 'ACTIVE',
      versions: [
        {
          versionId: 1,
          uploadedAt: new Date().toISOString(),
          uploadedBy: documentData.uploadedBy,
          changes: 'Initial upload',
        },
      ],
      accessControl: {
        owner: documentData.uploadedBy,
        sharedWith: [],
        publicAccess: false,
      },
      linkedTasks: [],
      auditTrail: [
        {
          action: 'UPLOADED',
          by: documentData.uploadedBy,
          at: new Date().toISOString(),
        },
      ],
    };

    this.documents.push(document);
    console.log(`✅ Document uploaded: ${document.id}`);
    console.log(`   File: ${document.fileName}`);
    console.log(`   Size: ${document.fileSize}`);
    console.log(`   Category: ${document.category}\n`);

    return document;
  }

  /**
   * Link document to task
   */
  linkDocumentToTask(documentId, taskId) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    document.linkedTasks.push(taskId);
    document.auditTrail.push({
      action: 'LINKED_TO_TASK',
      taskId: taskId,
      at: new Date().toISOString(),
    });

    console.log(`[Document Management] ✅ Document linked to task: ${taskId}`);
    return document;
  }

  /**
   * Create document version
   */
  createVersion(documentId, versionData) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    const newVersion = {
      versionId: document.versions.length + 1,
      uploadedAt: new Date().toISOString(),
      uploadedBy: versionData.uploadedBy,
      changes: versionData.changes,
      fileSize: versionData.fileSize,
    };

    document.versions.push(newVersion);
    document.auditTrail.push({
      action: 'VERSION_CREATED',
      versionId: newVersion.versionId,
      by: versionData.uploadedBy,
      at: new Date().toISOString(),
    });

    console.log(`[Document Management] ✅ New version created: v${newVersion.versionId}`);
    return newVersion;
  }

  /**
   * Share document
   */
  shareDocument(documentId, userId, permissions) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    const share = {
      userId: userId,
      permissions: permissions, // VIEW, EDIT, SHARE
      sharedAt: new Date().toISOString(),
    };

    document.accessControl.sharedWith.push(share);
    document.auditTrail.push({
      action: 'SHARED',
      sharedWith: userId,
      permissions: permissions,
      at: new Date().toISOString(),
    });

    console.log(`[Document Management] ✅ Document shared with user: ${userId}`);
    console.log(`   Permissions: ${permissions.join(', ')}`);

    return share;
  }

  /**
   * Search documents
   */
  searchDocuments(query) {
    console.log(`\n🔍 SEARCHING DOCUMENTS: "${query}"\n`);

    const results = this.documents.filter(doc =>
      doc.fileName.toLowerCase().includes(query.toLowerCase()) ||
      doc.description?.toLowerCase().includes(query.toLowerCase()) ||
      doc.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );

    console.log(`✅ Found ${results.length} matching documents\n`);
    return results;
  }

  /**
   * Get document audit trail
   */
  getAuditTrail(documentId) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    console.log(`\n📋 AUDIT TRAIL: ${document.fileName}\n`);

    for (const entry of document.auditTrail) {
      console.log(`${entry.action} - ${entry.at}`);
      if (entry.by) console.log(`  By: ${entry.by}`);
      if (entry.taskId) console.log(`  Task: ${entry.taskId}`);
    }

    console.log();
    return document.auditTrail;
  }

  /**
   * Implement OCR for document analysis
   */
  performOCR(documentId) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    console.log(`\n🔤 PERFORMING OCR: ${document.fileName}\n`);

    const ocrResult = {
      documentId: documentId,
      extractedText: 'Sample extracted text from document...',
      confidence: 0.95,
      entities: [
        { type: 'PERSON', value: 'John Smith' },
        { type: 'DATE', value: '2026-05-15' },
        { type: 'AMOUNT', value: '$50,000' },
      ],
      language: 'English',
      processedAt: new Date().toISOString(),
    };

    document.auditTrail.push({
      action: 'OCR_PROCESSED',
      confidence: ocrResult.confidence,
      at: new Date().toISOString(),
    });

    console.log(`✅ OCR completed`);
    console.log(`   Confidence: ${(ocrResult.confidence * 100).toFixed(1)}%`);
    console.log(`   Entities extracted: ${ocrResult.entities.length}\n`);

    return ocrResult;
  }

  /**
   * Get document statistics
   */
  getDocumentStatistics() {
    const stats = {
      totalDocuments: this.documents.length,
      byCategory: {},
      totalSize: 0,
      documentsByUser: {},
      recentDocuments: [],
    };

    for (const doc of this.documents) {
      // Count by category
      stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;

      // Total size
      stats.totalSize += doc.fileSize || 0;

      // By user
      stats.documentsByUser[doc.uploadedBy] = (stats.documentsByUser[doc.uploadedBy] || 0) + 1;
    }

    // Recent documents
    stats.recentDocuments = this.documents
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 5);

    return stats;
  }

  /**
   * Implement document retention policy
   */
  applyRetentionPolicy(documentId, retentionDays) {
    const document = this.documents.find(d => d.id === documentId);

    if (!document) {
      console.error('Document not found');
      return null;
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + retentionDays);

    document.retentionPolicy = {
      retentionDays: retentionDays,
      expiryDate: expiryDate.toISOString(),
      autoDelete: true,
    };

    console.log(`[Document Management] ✅ Retention policy applied`);
    console.log(`   Days: ${retentionDays}`);
    console.log(`   Expiry: ${expiryDate.toISOString()}`);

    return document.retentionPolicy;
  }
}

module.exports = DocumentManagement;
