import { 
  EC2Client, 
  DescribeSecurityGroupsCommand, 
  DescribeNetworkInterfacesCommand, 
  DescribeInstancesCommand, 
  DeleteSecurityGroupCommand 
} from "@aws-sdk/client-ec2";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const retryOperation = async (operation, maxAttempts = 5, delayMs = 2000) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (error.name === "ThrottlingException" && attempt < maxAttempts) {
        console.warn(`Throttled. Retrying (${attempt}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Operation failed after ${maxAttempts} attempts.`);
};

const listLambdaFunctionsWithRetry = async (lambdaClient) => {
  let totalFunctions = [];
  let nextMarker = null;

  do {
    const response = await retryOperation(() =>
      lambdaClient.send(new ListFunctionsCommand({ Marker: nextMarker }))
    );
    totalFunctions = totalFunctions.concat(response.Functions);
    nextMarker = response.NextMarker;
  } while (nextMarker);

  return totalFunctions;
};

export const cleanupUnusedSecurityGroups = async (event) => {
  const ec2Client = new EC2Client({});
  const lambdaClient = new LambdaClient({});
  const cloudWatchClient = new CloudWatchClient({});

  try {
    const { SecurityGroups } = await ec2Client.send(new DescribeSecurityGroupsCommand({}));

    const { NetworkInterfaces } = await ec2Client.send(new DescribeNetworkInterfacesCommand({}));
    const associatedSecurityGroups = new Set();

    for (const iface of NetworkInterfaces) {
      (iface.Groups || []).forEach((group) => associatedSecurityGroups.add(group.GroupId));
    }

    const { Reservations } = await ec2Client.send(new DescribeInstancesCommand({}));
    Reservations.forEach((reservation) => {
      reservation.Instances.forEach((instance) => {
        (instance.SecurityGroups || []).forEach((group) => associatedSecurityGroups.add(group.GroupId));
      });
    });

    const lambdaFunctions = await listLambdaFunctionsWithRetry(lambdaClient);
    lambdaFunctions.forEach((func) => {
      if (func.VpcConfig && func.VpcConfig.SecurityGroupIds) {
        func.VpcConfig.SecurityGroupIds.forEach((groupId) =>
          associatedSecurityGroups.add(groupId)
        );
      }
    });

    const unusedSecurityGroups = SecurityGroups.filter(
      (group) =>
        !associatedSecurityGroups.has(group.GroupId) && // Not in use
        group.GroupName !== "default"                  // Not the default security group
    );

    console.log(`Found ${unusedSecurityGroups.length} unused security groups.`);

    const deleteResults = [];
    for (const group of unusedSecurityGroups) {
      try {
        console.log(`Attempting to delete security group: ${group.GroupName} (${group.GroupId})`);
        await retryOperation(() =>
          ec2Client.send(new DeleteSecurityGroupCommand({ GroupId: group.GroupId }))
        );
        deleteResults.push({ GroupId: group.GroupId, GroupName: group.GroupName, Status: "Deleted" });
        console.log(`Successfully deleted security group: ${group.GroupName} (${group.GroupId})`);
      } catch (deleteError) {
        console.error(`Failed to delete security group: ${group.GroupName} (${group.GroupId})`, deleteError);
        deleteResults.push({ GroupId: group.GroupId, GroupName: group.GroupName, Status: "Failed", Error: deleteError.message });
      }
    }

    try {
      await cloudWatchClient.send(
        new PutMetricDataCommand({
          Namespace: "Custom/SecurityGroupCleanup",
          MetricData: [
            {
              MetricName: "DeletedSecurityGroups",
              Value: deleteResults.filter((result) => result.Status === "Deleted").length,
              Unit: "Count",
              Dimensions: [
                {
                  Name: "FunctionName",
                  Value: process.env.AWS_LAMBDA_FUNCTION_NAME || "UnknownFunction",
                },
              ],
            },
          ],
        })
      );
      console.log(`CloudWatch metric pushed: DeletedSecurityGroups = ${deleteResults.filter((result) => result.Status === "Deleted").length}`);
    } catch (metricError) {
      console.error("Failed to push CloudWatch metric:", metricError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Unused security group cleanup complete",
        deleteResults,
      }),
    };
  } catch (error) {
    console.error("Error cleaning up unused security groups:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error cleaning up unused security groups",
        error: error.message,
      }),
    };
  }
};
