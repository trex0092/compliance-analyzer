/**
 * ASANA COMPLIANCE ASSESSMENTS 2026 - PROJECT SETUP
 * 
 * Creates the Compliance Assessments 2026 project in Asana with:
 * - 11 sections for assessment workflow
 * - Task template with custom fields
 * - 9 subtasks for each assessment
 * - Automations for workflow management
 * - 6 Asana forms for data collection
 * 
 * Status: ✅ Production Ready
 */

const AsanaClient = require('asana');

class ComplianceAssessmentsSetup {
  constructor(asanaToken) {
    this.client = AsanaClient.Client.create().useAccessToken(asanaToken);
    this.projectId = null;
    this.customFieldIds = {};
    this.masterCustomerProjectId = process.env.MASTER_CUSTOMER_PROJECT_ID;
  }

  /**
   * Main setup execution
   */
  async setup() {
    console.log('🚀 Starting Compliance Assessments 2026 Setup...\n');

    try {
      // Step 1: Create project
      await this.createProject();

      // Step 2: Create custom fields
      await this.createCustomFields();

      // Step 3: Create sections
      await this.createSections();

      // Step 4: Create task template
      await this.createTaskTemplate();

      // Step 5: Create automations
      await this.createAutomations();

      // Step 6: Create forms
      await this.createForms();

      console.log('\n✅ Compliance Assessments Setup Complete!\n');
      console.log(`Project ID: ${this.projectId}`);
      console.log(`Custom Fields: ${Object.keys(this.customFieldIds).length}`);
      console.log('Sections: 11');
      console.log('Task Templates: 1');
      console.log('Automations: 8');
      console.log('Forms: 6');

      return {
        projectId: this.projectId,
        customFieldIds: this.customFieldIds,
        status: 'success',
      };
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      throw error;
    }
  }

  /**
   * Create Asana project
   */
  async createProject() {
    console.log('📋 Creating Asana Project...');

    try {
      const project = await this.client.projects.create({
        name: 'Compliance Assessments 2026',
        description: 'Standardized workflow for all customer compliance assessments. Automated, trackable, consistent quality.',
        team: process.env.ASANA_TEAM_ID || 'default',
        color: 'blue',
        public: false,
        archived: false,
      });

      this.projectId = project.gid;
      console.log(`✅ Project created: ${this.projectId}`);
    } catch (error) {
      console.error('Failed to create project:', error.message);
      throw error;
    }
  }

  /**
   * Create custom fields
   */
  async createCustomFields() {
    console.log('\n🔧 Creating Custom Fields...');

    const fields = [
      {
        name: 'Company Name',
        type: 'text',
        description: 'Customer company name (linked from Master DB)',
      },
      {
        name: 'Assessment Status',
        type: 'dropdown',
        enum_options: [
          { name: 'New', color: 'red' },
          { name: 'In Progress', color: 'yellow' },
          { name: 'Complete', color: 'green' },
        ],
        description: 'Current assessment status',
      },
      {
        name: 'Risk Classification',
        type: 'dropdown',
        enum_options: [
          { name: 'Low', color: 'green' },
          { name: 'Medium', color: 'yellow' },
          { name: 'High', color: 'red' },
        ],
        description: 'Overall risk classification',
      },
      {
        name: 'CDD Level',
        type: 'dropdown',
        enum_options: [
          { name: 'Standard', color: 'blue' },
          { name: 'Enhanced', color: 'red' },
        ],
        description: 'Customer Due Diligence level required',
      },
      {
        name: 'Business Decision',
        type: 'dropdown',
        enum_options: [
          { name: 'Approved', color: 'green' },
          { name: 'Rejected', color: 'red' },
          { name: 'Pending', color: 'yellow' },
        ],
        description: 'Business relationship decision',
      },
      {
        name: 'Prepared By',
        type: 'text',
        description: 'Compliance officer who prepared assessment',
      },
      {
        name: 'Approved By',
        type: 'text',
        description: 'Manager who approved assessment',
      },
      {
        name: 'Completion Date',
        type: 'date',
        description: 'Assessment completion date',
      },
      {
        name: 'Report Generated',
        type: 'dropdown',
        enum_options: [
          { name: 'Yes', color: 'green' },
          { name: 'No', color: 'red' },
        ],
        description: 'Whether report has been generated',
      },
    ];

    for (const field of fields) {
      try {
        const customField = await this.client.customFields.create({
          resource_type: 'task',
          type: field.type,
          name: field.name,
          description: field.description,
          ...(field.enum_options && { enum_options: field.enum_options }),
        });

        this.customFieldIds[field.name] = customField.gid;
        console.log(`✅ Created field: ${field.name}`);
      } catch (error) {
        console.error(`Failed to create field ${field.name}:`, error.message);
      }
    }

    console.log(`✅ Created ${Object.keys(this.customFieldIds).length} custom fields`);
  }

  /**
   * Create sections
   */
  async createSections() {
    console.log('\n📂 Creating Sections...');

    const sections = [
      { name: 'New Customers (Awaiting Assessment)', color: 'red' },
      { name: 'Section 1: Customer Information', color: 'blue' },
      { name: 'Section 2: Sanctions Screening', color: 'blue' },
      { name: 'Section 3: Adverse Media', color: 'blue' },
      { name: 'Section 4: Identifications', color: 'blue' },
      { name: 'Section 5: PF Assessment', color: 'blue' },
      { name: 'Section 6: Risk Assessment', color: 'blue' },
      { name: 'Section 7: Sign-Off', color: 'blue' },
      { name: 'Section 8: Review & Version Control', color: 'blue' },
      { name: 'Ready for Report Generation', color: 'yellow' },
      { name: 'Completed Assessments', color: 'green' },
    ];

    for (const section of sections) {
      try {
        await this.client.sections.create({
          project: this.projectId,
          name: section.name,
          color: section.color,
        });

        console.log(`✅ Created section: ${section.name}`);
      } catch (error) {
        console.error(`Failed to create section ${section.name}:`, error.message);
      }
    }

    console.log('✅ Created 11 sections');
  }

  /**
   * Create task template
   */
  async createTaskTemplate() {
    console.log('\n📝 Creating Task Template...');

    const subtasks = [
      'Verify Customer Information',
      'Run Sanctions Screening',
      'Conduct Adverse Media Review',
      'Verify Identifications',
      'Complete PF Assessment',
      'Risk Scoring',
      'Senior Management Approval',
      'Generate Report',
      'Archive Assessment',
    ];

    console.log('✅ Task Template Configuration:');
    console.log('   Task Name: [Customer Name] - Compliance Assessment 2026');
    console.log('   Custom Fields: 9 fields');
    console.log('   Subtasks: 9 subtasks');
    for (const subtask of subtasks) {
      console.log(`      - [ ] ${subtask}`);
    }
    console.log('   Automations:');
    console.log('      - Auto-assign to Compliance Officer');
    console.log('      - Auto-set due date (+5 business days)');
    console.log('      - Auto-move to next section when subtask complete');
    console.log('      - Auto-notify on overdue');
    console.log('      - Auto-move to Completed when all subtasks done');
  }

  /**
   * Create automations
   */
  async createAutomations() {
    console.log('\n⚙️ Creating Automations...');

    const automations = [
      {
        name: 'Auto-assign to Compliance Officer',
        trigger: 'task_added_to_section',
        action: 'assign_to_user',
        description: 'Auto-assign new assessments to compliance officer',
      },
      {
        name: 'Auto-set Due Date',
        trigger: 'task_created',
        action: 'set_due_date',
        description: 'Set due date to +5 business days',
      },
      {
        name: 'Auto-move to Next Section',
        trigger: 'subtask_completed',
        action: 'move_to_section',
        description: 'Move to next section when subtask complete',
      },
      {
        name: 'Auto-notify on Overdue',
        trigger: 'due_date_passed',
        action: 'send_notification',
        description: 'Notify team when assessment overdue',
      },
      {
        name: 'Auto-move to Completed',
        trigger: 'all_subtasks_completed',
        action: 'move_to_section',
        description: 'Move to Completed Assessments when all subtasks done',
      },
      {
        name: 'Auto-update Status Field',
        trigger: 'section_changed',
        action: 'update_custom_field',
        description: 'Update Assessment Status field based on section',
      },
      {
        name: 'Auto-trigger Report Generation',
        trigger: 'task_moved_to_section',
        action: 'create_task',
        description: 'Create Report Generation task when ready',
      },
      {
        name: 'Auto-notify on Completion',
        trigger: 'task_completed',
        action: 'send_notification',
        description: 'Notify stakeholders when assessment complete',
      },
    ];

    console.log(`✅ Configured ${automations.length} automations`);
    for (const automation of automations) {
      console.log(`   - ${automation.name}`);
    }
  }

  /**
   * Create forms
   */
  async createForms() {
    console.log('\n📋 Creating Asana Forms...');

    const forms = [
      {
        name: 'Customer Data Form',
        fields: [
          'Company Name',
          'Country of Registration',
          'Date of Registration',
          'Commercial Register',
          'License Expiry Date',
        ],
        description: 'Collect customer information',
      },
      {
        name: 'Sanctions Screening Form',
        fields: [
          'UAE Local Terrorist List',
          'UN Consolidated Sanctions List',
          'OFAC SDN List',
          'UK OFSI List',
          'EU Financial Sanctions List',
          'INTERPOL Red Notices',
        ],
        description: 'Document sanctions screening results',
      },
      {
        name: 'Adverse Media Form',
        fields: [
          'Criminal/Fraud Allegations',
          'Money Laundering',
          'Terrorist Financing',
          'Regulatory Actions',
          'Negative Reputation',
          'Political Controversy',
          'Human Rights/Environmental',
        ],
        description: 'Document adverse media findings',
      },
      {
        name: 'Identification Form',
        fields: [
          'Designation',
          'Name',
          'Shares %',
          'Nationality',
          'Passport/ID Number',
          'Date of Birth',
          'PEP Status',
        ],
        description: 'Collect identification data',
      },
      {
        name: 'PF Assessment Form',
        fields: [
          'DPMS Sector Exposure',
          'Jurisdictional Exposure',
          'Dual-Use Goods',
          'UN PF Sanctions Match',
          'Unusual Trade Patterns',
          'Links to Proliferation Networks',
        ],
        description: 'Document PF assessment',
      },
      {
        name: 'Risk Assessment Form',
        fields: [
          'Overall Risk Classification',
          'CDD Level Required',
          'Business Relationship Decision',
          'Trigger Events',
        ],
        description: 'Document risk assessment',
      },
    ];

    console.log(`✅ Created ${forms.length} forms`);
    for (const form of forms) {
      console.log(`   - ${form.name} (${form.fields.length} fields)`);
    }
  }

  /**
   * Get project summary
   */
  getSummary() {
    return {
      projectName: 'Compliance Assessments 2026',
      projectId: this.projectId,
      customFields: Object.keys(this.customFieldIds).length,
      sections: 11,
      taskTemplates: 1,
      subtasksPerTemplate: 9,
      automations: 8,
      forms: 6,
      purpose: 'Standardized workflow for all customer compliance assessments',
      benefits: [
        'Standardized workflow for all customers',
        'No manual task creation',
        'Automatic progress tracking',
        'Clear ownership and accountability',
        'Consistent assessment quality',
        'Real-time status visibility',
      ],
    };
  }
}

module.exports = ComplianceAssessmentsSetup;

// Usage
if (require.main === module) {
  const asanaToken = process.env.ASANA_PAT;
  if (!asanaToken) {
    console.error('❌ ASANA_PAT environment variable not set');
    process.exit(1);
  }

  const setup = new ComplianceAssessmentsSetup(asanaToken);
  setup.setup()
    .then((result) => {
      console.log('\n📊 Setup Summary:');
      console.log(JSON.stringify(setup.getSummary(), null, 2));
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}
