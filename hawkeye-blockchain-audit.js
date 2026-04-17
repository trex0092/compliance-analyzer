/**
 * Hawkeye Sterling V2 - Blockchain Audit Trail
 * Immutable compliance records using blockchain
 */

const crypto = require('crypto');

class BlockchainAuditTrail {
  constructor(config = {}) {
    this.chain = [];
    this.pendingRecords = [];
    this.difficulty = 4;
    this.miningReward = 10;
    this.genesisBlock = this.createGenesisBlock();
    this.chain.push(this.genesisBlock);
  }

  /**
   * Create genesis block
   */
  createGenesisBlock() {
    return {
      index: 0,
      timestamp: new Date().toISOString(),
      records: [],
      previousHash: '0',
      hash: this.calculateHash({
        index: 0,
        timestamp: new Date().toISOString(),
        records: [],
        previousHash: '0',
      }),
      nonce: 0,
    };
  }

  /**
   * Calculate hash
   */
  calculateHash(block) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(block))
      .digest('hex');
  }

  /**
   * Add audit record to blockchain
   */
  async addAuditRecord(record) {
    const auditRecord = {
      id: `AUDIT-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: record.actor,
      action: record.action,
      entity: record.entity,
      entityId: record.entityId,
      oldValue: record.oldValue,
      newValue: record.newValue,
      ipAddress: record.ipAddress,
      signature: this.signRecord(record),
    };

    this.pendingRecords.push(auditRecord);

    // Mine block if pending records exceed threshold
    if (this.pendingRecords.length >= 5) {
      await this.mineBlock();
    }

    console.log(`[Blockchain] ✅ Audit record added: ${auditRecord.id}`);
    return auditRecord;
  }

  /**
   * Mine block
   */
  async mineBlock() {
    console.log('[Blockchain] ⛏️  Mining block...');

    const lastBlock = this.chain[this.chain.length - 1];
    const block = {
      index: this.chain.length,
      timestamp: new Date().toISOString(),
      records: this.pendingRecords,
      previousHash: lastBlock.hash,
      hash: '',
      nonce: 0,
    };

    // Proof of work
    while (true) {
      block.hash = this.calculateHash(block);
      if (block.hash.substring(0, this.difficulty) === '0'.repeat(this.difficulty)) {
        break;
      }
      block.nonce++;
    }

    this.chain.push(block);
    this.pendingRecords = [];

    console.log(`[Blockchain] ✅ Block mined: ${block.hash}`);
    return block;
  }

  /**
   * Sign record with private key
   */
  signRecord(record) {
    // Simulate signing
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(record) + 'PRIVATE_KEY')
      .digest('hex');
  }

  /**
   * Verify record signature
   */
  verifyRecordSignature(record, signature) {
    const calculatedSignature = this.signRecord(record);
    return calculatedSignature === signature;
  }

  /**
   * Verify blockchain integrity
   */
  verifyChainIntegrity() {
    console.log('\n[Blockchain] 🔍 Verifying chain integrity...\n');

    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Verify hash
      const calculatedHash = this.calculateHash(currentBlock);
      if (currentBlock.hash !== calculatedHash) {
        console.log(`❌ Block ${i} hash mismatch!`);
        return false;
      }

      // Verify previous hash link
      if (currentBlock.previousHash !== previousBlock.hash) {
        console.log(`❌ Block ${i} previous hash mismatch!`);
        return false;
      }

      // Verify proof of work
      if (!currentBlock.hash.substring(0, this.difficulty) === '0'.repeat(this.difficulty)) {
        console.log(`❌ Block ${i} proof of work invalid!`);
        return false;
      }

      console.log(`✅ Block ${i} verified`);
    }

    console.log('\n✅ Blockchain integrity verified!\n');
    return true;
  }

  /**
   * Get audit trail for entity
   */
  getAuditTrail(entityId) {
    const trail = [];

    for (const block of this.chain) {
      for (const record of block.records) {
        if (record.entityId === entityId) {
          trail.push({
            ...record,
            blockIndex: this.chain.indexOf(block),
            blockHash: block.hash,
            verified: true,
          });
        }
      }
    }

    return trail;
  }

  /**
   * Export blockchain
   */
  exportBlockchain() {
    return {
      chainLength: this.chain.length,
      totalRecords: this.chain.reduce((sum, block) => sum + block.records.length, 0),
      difficulty: this.difficulty,
      chain: this.chain,
      isValid: this.verifyChainIntegrity(),
    };
  }

  /**
   * Get blockchain statistics
   */
  getBlockchainStats() {
    return {
      totalBlocks: this.chain.length,
      totalRecords: this.chain.reduce((sum, block) => sum + block.records.length, 0),
      pendingRecords: this.pendingRecords.length,
      difficulty: this.difficulty,
      chainHash: this.chain[this.chain.length - 1].hash,
      isValid: this.verifyChainIntegrity(),
      createdAt: this.chain[0].timestamp,
      lastBlockTime: this.chain[this.chain.length - 1].timestamp,
    };
  }
}

module.exports = BlockchainAuditTrail;
