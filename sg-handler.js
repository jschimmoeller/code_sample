// global space
const aws = require("aws-sdk");
const jsforce = require("jsforce");
const dateFns = require("date-fns");
const Bugsnag = require("@bugsnag/js");

/*******************************************
 * Check the progress of groups and validate
 * study guide options
 *
 * This will only work for week 2 or 4
 */
module.exports.process = async (event) => {
  console.log("group study guide check process started");

  // logging errors
  Bugsnag.start({
    apiKey: process.env.bugsnag_api_key,
    releaseStage: process.env.bugsnag_stage,
  });

  // salesfource conn object
  const conn = new jsforce.Connection({
    loginUrl: process.env.sf_url,
  });

  aws.config.update({
    accessKeyId: process.env.aws_id,
    secretAccessKey: process.env.aws_secret,
    region: process.env.dynamodb_region,
  });

  try {
    // console.log(process.env);
    // this is the login for salesforce connection
    const uSF = await conn.login(process.env.sf_user, process.env.sf_pwd);
    // building document client
    const docClient = new aws.DynamoDB.DocumentClient({
      apiVersion: "2012-08-10",
    });

    const todaysDate = new Date();

    // local groups
    // groups  in the  last 24  hours
    const l = await docClient
      .query({
        TableName: process.env.db_table,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3_pk= :m and (gsi3_sk between :s and :e)",
        EtodayDatepressionAttributeValues: {
          ":m": "meeting",
          ":s": `M:local:${dateFns.getTime(dateFns.subDays(todaysDate, 1))}`,
          ":e": `M:local:${dateFns.getTime(todaysDate)}`,
        },
      })
      .promise();

    // online groups --
    const o = await docClient
      .query({
        TableName: process.env.db_table,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3_pk= :m and gsi3_sk between :s and :e",
        ExpressionAttributeValues: {
          ":m": "meeting",
          ":s": `M:online:${dateFns.getTime(dateFns.subDays(todaysDate, 1))}`,
          ":e": `M:online:${dateFns.getTime(todaysDate)}`,
        },
      })
      .promise();

    // console.log("ooooo", JSON.stringify(o));
    // return;

    // console.log("ng", qrv, ng);
    // build temp object

    // combine both online and local groups together ...
    const items = [].concat(l.Items.length > 0 ? l.Items : []).concat(o.Items.length > 0 ? o.Items : []);

    // console.log("meeting count: " + m.Items.length);
    // process them
    for (var i = 0; i < items.length; i++) {
      // ok for each meeting process it
      const theMeeting = items[i];
      // get the group object
      const g = await docClient
        .query({
          TableName: process.env.db_table,
          KeyConditionExpression: "pk= :g and begins_with(sk, :t)",
          ExpressionAttributeValues: {
            ":g": theMeeting.gsi2_pk,
            ":t": `G:`,
          },
        })
        .promise();
      // console.log("g", JSON.stringify(g, null, 2));

      if (g.Items.length < 1) {
        // ignore orphan record
        continue;
      }
      // got the group
      const theGroup = g.Items[0];

      // check if wrong series or not acdtive
      if (theGroup.series_id > 999 || theGroup.group_status !== "active") {
        continue;
      }

      //JES - 06/03 - Ticket #321 ... check to see if account is active yet
      const userAccount = await docClient
        .query({
          TableName: process.env.db_table,
          KeyConditionExpression: "pk= :g and begins_with(sk, :t)",
          ExpressionAttributeValues: {
            ":g": theGroup.gsi1_pk,
            ":t": `U:`,
          },
        })
        .promise();

      if (userAccount && userAccount.Items && userAccount.Items.length > 0) {
        const u = userAccount.Items[0];
        // is active
        if (u.person_status !== "active") {
          // nope canceled account
          continue;
        }
      }
      // JES End Ticket

      const confirmedMembersEmails =
        theGroup.attributes.members &&
        theGroup.attributes.members.reduce((p, m) => {
          if (m.member_status === "confirm") {
            return p.concat(m.email);
          }
          return p;
        }, []);

      if (!confirmedMembersEmails || confirmedMembersEmails.length == 0) {
        // no confirmed members
        // console.log("no members", theGroup.attributes);
        continue;
      }

      if (!theGroup.attributes.when || !theGroup.attributes.when.hasOwnProperty("start_date")) {
        console.log("no start date for this group so i will skip it");
        continue;
      }

      // get weeks since start of meeting
      // adding hours to skip instant meetings
      const days = dateFns.differenceInCalendarDays(dateFns.addHours(todaysDate, 12), new Date(theGroup.attributes.when.start_date));

      // bi weekly mieetings we divide by 14  not 7
      const weeks = days < 7 && days > 0 ? 1 : Math.ceil(days / 7);

      if (weeks < 2) {
        continue; // must be week 2 or beyond
      }
      // find out if everyone has a study guide
      const uaData = await docClient
        .query({
          TableName: process.env.db_table,
          IndexName: "gsi1",
          KeyConditionExpression: "gsi1_pk= :a and begins_with(gsi1_sk, :t)",
          ExpressionAttributeValues: {
            ":a": theMeeting.gsi1_pk,
            ":t": `UA:member:`,
          },
        })
        .promise();
      let noStudyGuide = [];
      for (let i = 0; i < confirmedMembersEmails.length; i++) {
        const email = confirmedMembersEmails[i];
        // find user account
        const u =
          uaData.Items &&
          uaData.Items.reduce((p, x) => {
            if (!p) {
              if (x.gsi4_pk === email) {
                return x;
              }
            }
            return p;
          }, undefined);
        // check study guide option
        if ((u && !u.hasOwnProperty("study_guide_option")) || (u && ["none", "revoked"].indexOf(u.study_guide_option) > -1)) {
          noStudyGuide.push(email);
        } else {
          // console.log("user has study guide", email, u.study_guide_option);
        }
      }
      // do i have no study guides to process
      if (noStudyGuide.length > 0) {
        // create  task  to call
        console.log("user missing study guuide ....  create task ", theMeeting.gsi1_pk, theGroup.series_id, noStudyGuide);

        try {
          // 3.  create a task to  call them
          //
          // lookup account id ;
          const f = await conn.sobject("Account").find({
            platform_reference_id__c: theMeeting.gsi1_pk,
          });
          let newAccount;
          if (!f || f.length == 0) {
            throw new Error("missing account in sales force: " + theMeeting.gsi1_pk);
          } else {
            newAccount = f[0];
          }
          // create task object here
          const t = {
            Description:
              "confirmed member with no ISG after week 2.  We have found the following members  with no study guide: " +
              noStudyGuide.join(", ") +
              ". Leaders for this  group are: " +
              (theGroup.leaders ? theGroup.leaders.join(", ") : "none") +
              ".",
            Subject: `Call Leader for group: ${theGroup.attributes.full_name}`,
            ActivityDate: dateFns.format(new Date(), "yyyy-MM-dd"),
            WhatId: newAccount.Id,
          };

          // assign to julie
          const sfAcct = await conn.sobject("User").find({ Username: process.env.SF_USER });
          if (sfAcct && sfAcct.length > 0) {
            // console.log("found julie account, setting both owner  id to: ", jpAcct[0]);
            t.OwnerId = sfAcct[0].Id;
          }

          // console.log("before creating task", t);
          const aTask = await conn.sobject("Task").create(t);
          // console.log("task created in salesforce with: ", newAccount);
        } catch (z) {
          console.error("create account or task threw this error: ", z);
          Bugsnag.notify(z, (event) => {
            event.addMetadata("serverless_details", {
              process: "crm-integration",
              message: msg,
            });
          });
        }
      }
    }

    return {};
  } catch (e) {
    console.log("throwing of master error: ", e);
    Bugsnag.notify(e, (x) => {
      x.addMetadata("serverless_details", {
        api_func_name: "group-sg",
      });
    });
  }
};
