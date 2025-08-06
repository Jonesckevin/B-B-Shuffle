/**
 * Backdoors & Breaches Game Master Assistant
 * Generates complete scenarios with random card selection and narrative guidance
 */

class BackdoorsBreachesGM {
    constructor() {
        this.attackCards = {
            initialCompromise: [
                { name: "Phish", detection: ["Firewall Logs", "Endpoint Security Alerts", "Email Security Analysis"] },
                { name: "Web Server Compromise", detection: ["Server Analysis", "Firewall Log Review", "NetFlow Analysis"] },
                { name: "External Cloud Access", detection: ["SIEM Log Analysis", "UEBA", "Cloud Security Logs"] },
                { name: "Insider Threat", detection: ["UEBA", "Endpoint Analysis", "SIEM Log Analysis"] },
                { name: "Password Spray", detection: ["UEBA", "SIEM Log Analysis", "Firewall Logs"] },
                { name: "Trusted Relationship", detection: ["NetFlow Analysis", "SIEM Log Analysis", "Firewall Log Review"] },
                { name: "Social Engineering", detection: ["UEBA", "Endpoint Analysis", "Crisis Management"] },
                { name: "Bring Your Own (Exploited) Device", detection: ["Endpoint Analysis", "NetFlow Analysis", "UEBA"] },
                { name: "Exploitable External Service", detection: ["Server Analysis", "NetFlow Analysis", "Firewall Log Review"] },
                { name: "Credential Stuffing", detection: ["UEBA", "SIEM Log Analysis", "Firewall Logs"] }
            ],
            pivotEscalate: [
                { name: "Internal Password Spray", detection: ["UEBA", "SIEM Log Analysis", "Endpoint Analysis"] },
                { name: "Kerberoasting", detection: ["SIEM Log Analysis", "UEBA", "Server Analysis"] },
                { name: "Broadcast/Multicast Protocol Poisoning", detection: ["NetFlow Analysis", "SIEM Log Analysis", "Firewall Log Review"] },
                { name: "Weaponizing Active Directory", detection: ["SIEM Log Analysis", "Server Analysis", "UEBA"] },
                { name: "Credential Stuffing", detection: ["UEBA", "SIEM Log Analysis", "Firewall Logs"] },
                { name: "New Service Creation", detection: ["Endpoint Analysis", "Server Analysis", "SIEM Log Analysis"] },
                { name: "Local Privilege Escalation", detection: ["Endpoint Analysis", "Endpoint Security Protection Analysis", "Server Analysis"] }
            ],
            persistence: [
                { name: "Malicious Service/Just Malware", detection: ["Endpoint Security Protection Analysis", "Endpoint Analysis", "Server Analysis"] },
                { name: "DLL Attacks", detection: ["Endpoint Security Protection Analysis", "Endpoint Analysis", "SIEM Log Analysis"] },
                { name: "Malicious Driver", detection: ["Endpoint Analysis", "Endpoint Security Protection Analysis", "Server Analysis"] },
                { name: "New User Added", detection: ["SIEM Log Analysis", "UEBA", "Server Analysis"] },
                { name: "Application Shimming", detection: ["Endpoint Security Protection Analysis", "Endpoint Analysis", "SIEM Log Analysis"] },
                { name: "Malicious Browser Plugins", detection: ["Endpoint Analysis", "Endpoint Security Protection Analysis", "UEBA"] },
                { name: "Logon Scripts", detection: ["SIEM Log Analysis", "Endpoint Analysis", "Server Analysis"] },
                { name: "Evil Firmware", detection: ["Endpoint Security Protection Analysis", "Endpoint Analysis", "Server Analysis"] },
                { name: "Accessibility Features", detection: ["Endpoint Analysis", "SIEM Log Analysis", "UEBA"] }
            ],
            c2Exfil: [
                { name: "HTTP as Exfil", detection: ["NetFlow Analysis", "Firewall Log Review", "SIEM Log Analysis"] },
                { name: "HTTPS as Exfil", detection: ["NetFlow Analysis", "Firewall Log Review", "SIEM Log Analysis"] },
                { name: "DNS as C2", detection: ["NetFlow Analysis", "SIEM Log Analysis", "Firewall Log Review"] },
                { name: "Windows Background Intelligent Transfer Service (BITS)", detection: ["Endpoint Security Protection Analysis", "Endpoint Analysis", "SIEM Log Analysis"] },
                { name: "Gmail, Tumblr, Salesforce, Twitter as C2", detection: ["NetFlow Analysis", "Firewall Log Review", "UEBA"] },
                { name: "Domain fronting as C2", detection: ["NetFlow Analysis", "SIEM Log Analysis", "Firewall Log Review"] }
            ]
        };

        this.procedureCards = [
            "Server Analysis",
            "Security Information and Event Management (SIEM) Log Analysis",
            "Firewall Log Review",
            "NetFlow, Zeek/Bro, Real Intelligence Threat Analytics (RITA) Analysis",
            "Internal Segmentation",
            "Endpoint Security Protection Analysis",
            "User and Entity Behavior Analytics (UEBA)",
            "Endpoint Analysis",
            "Isolation",
            "Crisis Management",
            "Honeypots Deployed"
        ];

        this.injectCards = [
            "It was a Pentest",
            "Data Uploaded to Pastebin",
            "SIEM Analyst Returns from Splunk Training",
            "Take One Procedure Card Away",
            "Give the Defenders a Random Procedure Card",
            "Lead Handler Has a Baby, Takes FMLA Leave",
            "Bobby the Intern Kills the System You are Reviewing",
            "Legal Takes Your Only Skills Handler Into a Meeting to Explain the Incident",
            "Management Has Just Approved the Release of a New Procedure"
        ];

        this.narrativeTemplates = this.initializeNarrativeTemplates();
    }

    /**
     * Generate a complete scenario with random card selection
     */
    generateScenario() {
        // Randomly select one card from each attack category
        const selectedAttacks = {
            initialCompromise: this.getRandomCard(this.attackCards.initialCompromise),
            pivotEscalate: this.getRandomCard(this.attackCards.pivotEscalate),
            persistence: this.getRandomCard(this.attackCards.persistence),
            c2Exfil: this.getRandomCard(this.attackCards.c2Exfil)
        };

        // Randomly assign established vs other procedures
        const shuffledProcedures = this.shuffleArray([...this.procedureCards]);
        const establishedProcedures = shuffledProcedures.slice(0, 4);
        const otherProcedures = shuffledProcedures.slice(4);

        // Shuffle inject deck
        const shuffledInjects = this.shuffleArray([...this.injectCards]);

        // Generate scenario intro based on initial compromise
        const scenarioIntro = this.generateScenarioIntro(selectedAttacks.initialCompromise);

        return {
            attackCards: selectedAttacks,
            establishedProcedures,
            otherProcedures,
            injectDeck: shuffledInjects,
            scenarioIntro,
            narrativeExamples: this.generateNarrativeExamples(selectedAttacks)
        };
    }

    /**
     * Generate formatted scenario output
     */
    generateFormattedScenario() {
        const scenario = this.generateScenario();
        
        return `## **Scenario Output:**

**Playing Cards Placed:**

- Attack Cards:
    1. Initial Compromise: ${scenario.attackCards.initialCompromise.name}
        - Detection: ${scenario.attackCards.initialCompromise.detection.join(', ')}.
    2. Pivot & Escalate: ${scenario.attackCards.pivotEscalate.name}
        - Detection: ${scenario.attackCards.pivotEscalate.detection.join(', ')}.
    3. Persistence: ${scenario.attackCards.persistence.name}
        - Detection: ${scenario.attackCards.persistence.detection.join(', ')}.
    4. C2 & Exfil: ${scenario.attackCards.c2Exfil.name}
        - Detection: ${scenario.attackCards.c2Exfil.detection.join(', ')}.

- Inject Deck: [${scenario.injectDeck.join(', ')}]

- Established Procedures:
${scenario.establishedProcedures.map(proc => `  - ${proc}`).join('\n')}

- Other Procedures:
${scenario.otherProcedures.map(proc => `  - ${proc}`).join('\n')}

### **Scenario Intro**

"${scenario.scenarioIntro}"

${this.generateNarrativeSection(scenario.narrativeExamples)}

### **Game Ending**

1. **WIN** - All Attack Cards Revealed:
    - "Congratulations! You have successfully identified all four attack vectors and mitigated the breach. The SOC team can now implement measures to prevent future incidents."
2. **TIME'S UP** - 10 Turns Passed:
    - "Time's up! The breach remains partially unresolved. The SOC team will need to continue their investigation and remediation efforts in the future."
3. **INJECT TRIGGERED CHAOS** - Inject Card Ends Game:
    - "An unexpected event has occurred! The Inject card has triggered chaos, ending the game immediately. The SOC team will need to regroup and reassess their strategy for future incidents."`;
    }

    /**
     * Generate scenario introduction based on initial compromise
     */
    generateScenarioIntro(initialCard) {
        const intros = {
            "Phish": "The SOC manager has informed you of a potential breach. A user reported a suspicious email that led to a potential phishing site, which they only realized after clicking the link and entering their credentials before being redirected to Google.",
            "Web Server Compromise": "Your monitoring systems have detected unusual activity on one of your public-facing web servers. Multiple failed authentication attempts and suspicious file uploads suggest a potential compromise.",
            "External Cloud Access": "The security team has received alerts about unauthorized access attempts to your cloud infrastructure. Unusual login patterns from foreign IP addresses have triggered multiple security warnings.",
            "Insider Threat": "HR has reported suspicious behavior from an employee who recently had their access privileges modified. System logs show unusual after-hours access to sensitive data repositories.",
            "Password Spray": "Your authentication systems have logged numerous failed login attempts across multiple user accounts. The pattern suggests a coordinated password spray attack targeting your organization.",
            "Trusted Relationship": "A partner organization has contacted you about potential security issues affecting shared resources. They've noticed unusual network traffic patterns that may indicate a compromise.",
            "Social Engineering": "Multiple employees have reported receiving convincing phone calls from someone claiming to be IT support, requesting password resets and system access information.",
            "Bring Your Own (Exploited) Device": "Network monitoring has detected unusual traffic from personal devices connected to your BYOD network. Several devices appear to be communicating with suspicious external addresses.",
            "Exploitable External Service": "Vulnerability scans have revealed that one of your external-facing services has a critical security flaw. There are indications that this vulnerability may have already been exploited.",
            "Credential Stuffing": "Your user authentication logs show thousands of failed login attempts using previously breached credentials. Some attempts appear to have been successful against accounts with weak passwords."
        };
        
        return intros[initialCard.name] || "A potential security incident has been detected and requires immediate investigation.";
    }

    /**
     * Generate narrative examples for success/failure scenarios
     */
    generateNarrativeExamples(attackCards) {
        const examples = {
            success: {},
            failure: {}
        };

        // Generate examples for each attack card
        Object.entries(attackCards).forEach(([category, card]) => {
            examples.success[card.name] = this.generateSuccessNarrative(card);
            examples.failure[card.name] = this.generateFailureNarrative(card);
        });

        // Generate examples for procedure cards
        this.procedureCards.forEach(procedure => {
            examples.success[procedure] = this.generateProcedureSuccessNarrative(procedure);
            examples.failure[procedure] = this.generateProcedureFailureNarrative(procedure);
        });

        return examples;
    }

    /**
     * Generate narrative section for the formatted output
     */
    generateNarrativeSection(narrativeExamples) {
        let section = "##### User Roll Success Examples\n\n";
        
        section += "**Procedure Cards:**\n";
        this.procedureCards.forEach(procedure => {
            section += `- **${procedure}:** "${narrativeExamples.success[procedure]}"\n`;
        });

        section += "\n**Attack Cards:**\n";
        Object.entries(this.attackCards).forEach(([category, cards], index) => {
            const categoryNames = ["Initial Compromise", "Pivot & Escalate", "Persistence", "C2 & Exfil"];
            section += `${index + 1}. **${categoryNames[index]}**\n`;
            cards.forEach(card => {
                if (narrativeExamples.success[card.name]) {
                    section += `    - **${card.name}:** "${narrativeExamples.success[card.name]}"\n`;
                }
            });
        });

        section += "\n##### User Roll Failure Examples\n\n";
        
        section += "**Procedure Cards:**\n";
        this.procedureCards.forEach(procedure => {
            section += `- **${procedure}:** "${narrativeExamples.failure[procedure]}"\n`;
        });

        section += "\n**Attack Cards:**\n";
        Object.entries(this.attackCards).forEach(([category, cards], index) => {
            const categoryNames = ["Initial Compromise", "Pivot & Escalate", "Persistence", "C2 & Exfil"];
            section += `${index + 1}. **${categoryNames[index]}**\n`;
            cards.forEach(card => {
                if (narrativeExamples.failure[card.name]) {
                    section += `    - **${card.name}:** "${narrativeExamples.failure[card.name]}"\n`;
                }
            });
        });

        return section;
    }

    /**
     * Utility methods
     */
    getRandomCard(cardArray) {
        return cardArray[Math.floor(Math.random() * cardArray.length)];
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Initialize narrative templates for success/failure scenarios
     */
    initializeNarrativeTemplates() {
        return {
            procedureSuccess: {
                "Server Analysis": "Your server analysis reveals unauthorized processes and suspicious file modifications, providing clear evidence of system compromise and the attacker's persistence mechanisms.",
                "Security Information and Event Management (SIEM) Log Analysis": "SIEM log correlation uncovers a clear attack timeline, revealing the initial breach vector and subsequent lateral movement through your network infrastructure.",
                "Firewall Log Review": "Firewall logs expose suspicious outbound connections to known malicious IP addresses, confirming data exfiltration attempts and command-and-control communications.",
                "NetFlow, Zeek/Bro, Real Intelligence Threat Analytics (RITA) Analysis": "Network traffic analysis reveals abnormal communication patterns and data flows, identifying both the attack infrastructure and compromised internal systems.",
                "Internal Segmentation": "Network segmentation analysis shows unauthorized cross-segment communications, revealing how the attacker bypassed security controls to access sensitive areas.",
                "Endpoint Security Protection Analysis": "Endpoint protection systems detect malicious code execution, persistence mechanisms, and credential harvesting activities on compromised workstations.",
                "User and Entity Behavior Analytics (UEBA)": "Behavioral analysis identifies anomalous user activities, including unusual login patterns, privilege escalations, and abnormal data access attempts.",
                "Endpoint Analysis": "Detailed endpoint examination uncovers malware artifacts, modified system files, and evidence of attacker tools used for reconnaissance and data theft.",
                "Isolation": "Network isolation successfully contains the threat, preventing further lateral movement while preserving forensic evidence for detailed investigation.",
                "Crisis Management": "Crisis management protocols effectively coordinate response efforts, ensuring proper stakeholder communication and regulatory compliance throughout the incident.",
                "Honeypots Deployed": "Honeypot systems successfully lure and capture attacker activities, providing valuable intelligence about their tactics, techniques, and procedures."
            },
            procedureFailure: {
                "Server Analysis": "Server analysis yields inconclusive results due to log rotation, system reboots, or insufficient monitoring coverage in the affected timeframe.",
                "Security Information and Event Management (SIEM) Log Analysis": "SIEM analysis is hampered by data gaps, false positives, or incomplete log ingestion from critical security tools and network devices.",
                "Firewall Log Review": "Firewall log analysis reveals normal traffic patterns with no obvious indicators of compromise or malicious communications during the investigation period.",
                "NetFlow, Zeek/Bro, Real Intelligence Threat Analytics (RITA) Analysis": "Network traffic analysis shows typical business communications with no clear indicators of command-and-control or data exfiltration activities.",
                "Internal Segmentation": "Segmentation review reveals properly configured network controls with no evidence of unauthorized cross-segment communications or policy violations.",
                "Endpoint Security Protection Analysis": "Endpoint protection systems show clean results with no malware detections, suspicious processes, or indicators of compromise on the investigated systems.",
                "User and Entity Behavior Analytics (UEBA)": "Behavioral analysis indicates normal user activity patterns with no significant deviations from established baselines or risk thresholds.",
                "Endpoint Analysis": "Endpoint forensics reveals standard system configurations and normal file structures with no obvious signs of malware or unauthorized modifications.",
                "Isolation": "Isolation attempts are unsuccessful due to network connectivity issues, administrative access problems, or systems already being offline.",
                "Crisis Management": "Crisis management efforts are delayed due to communication challenges, stakeholder availability issues, or unclear escalation procedures.",
                "Honeypots Deployed": "Honeypot systems remain untouched, suggesting either the attack has not progressed to discoverable stages or attackers are avoiding obvious traps."
            }
        };
    }

    generateProcedureSuccessNarrative(procedure) {
        return this.narrativeTemplates.procedureSuccess[procedure] || 
               `Your ${procedure} reveals critical evidence that advances the investigation and uncovers important details about the security incident.`;
    }

    generateProcedureFailureNarrative(procedure) {
        return this.narrativeTemplates.procedureFailure[procedure] || 
               `Your ${procedure} attempt yields no actionable intelligence, requiring alternative investigation approaches to progress the incident response.`;
    }

    generateSuccessNarrative(card) {
        const successTemplates = {
            "Phish": "Email header analysis reveals the phishing campaign's infrastructure, including sender reputation, domain registration details, and the credential harvesting site's hosting provider.",
            "Web Server Compromise": "Web server logs expose the initial exploitation vector, revealing vulnerable application components and the attacker's subsequent file uploads and backdoor installations.",
            "External Cloud Access": "Cloud access logs confirm unauthorized authentication using compromised credentials, revealing the scope of accessed resources and potential data exposure.",
            "Internal Password Spray": "Authentication logs clearly show the systematic password spray pattern, identifying targeted accounts, source IP addresses, and successful compromise attempts.",
            "Malicious Service/Just Malware": "Malware analysis reveals the service's persistence mechanisms, command-and-control communications, and data collection capabilities deployed on compromised systems.",
            "HTTP as Exfil": "Network traffic analysis captures HTTP-based data exfiltration, identifying the destination servers, data types, and transmission schedules used by the attackers."
        };
        
        return successTemplates[card.name] || 
               `Investigation of ${card.name} reveals concrete evidence of the attack methodology, providing actionable intelligence for incident response and remediation efforts.`;
    }

    generateFailureNarrative(card) {
        const failureTemplates = {
            "Phish": "Email analysis reveals legitimate-appearing messages with no obvious malicious indicators, possibly due to sophisticated evasion techniques or incomplete forensic data.",
            "Web Server Compromise": "Web server examination shows normal operation with no clear evidence of compromise, potentially due to log cleanup or sophisticated hiding techniques.",
            "External Cloud Access": "Cloud access review indicates normal authentication patterns with no obvious signs of unauthorized access or credential misuse during the investigation period.",
            "Internal Password Spray": "Authentication log analysis reveals normal login activity with no clear patterns indicating systematic password spray attempts or account compromise.",
            "Malicious Service/Just Malware": "Service analysis reveals legitimate system processes with no obvious indicators of malicious activity or unauthorized code execution.",
            "HTTP as Exfil": "HTTP traffic analysis shows normal web communications with no clear indicators of data exfiltration or command-and-control activities."
        };
        
        return failureTemplates[card.name] || 
               `Investigation of ${card.name} yields no conclusive evidence, requiring additional analysis techniques or alternative investigation approaches to progress the case.`;
    }
}

// Export for use in web applications
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackdoorsBreachesGM;
}

// Global instance for direct browser use
window.BackdoorsBreachesGM = BackdoorsBreachesGM;