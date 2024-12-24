## Cleanup Unused Security Groups
This project automates the cleanup of unused AWS EC2 security groups. It identifies security groups that are not associated with any network interfaces, instances, or Lambda functions, and removes them. Additionally, it tracks the number of deletions via CloudWatch metrics.

## Features
- Identifies unused EC2 security groups across AWS infrastructure.
- Deletes unused security groups (except the default security group).
- Tracks the number of deleted security groups in AWS CloudWatch metrics.
- Runs automatically on a schedule using AWS Lambda and CloudWatch Events.

## Prerequisites
Node.js 20.x
AWS CLI configured with appropriate permissions
Serverless Framework version 3.x

## Permissions Required
The Lambda function requires the following permissions:

- ec2:DescribeSecurityGroups
- ec2:DescribeNetworkInterfaces
- ec2:DescribeInstances
- lambda:ListFunctions
- ec2:DeleteSecurityGroup
- cloudwatch:PutMetricData

## Installation

```bash
git clone <repository-url>
cd cleanup_unused_security_groups
npm install
serverless deploy
```

## Configuration
The function is triggered on a schedule using AWS CloudWatch Events. Update the schedule in serverless.yml if needed.

## Sample CloudWatch log
<div align="center">
    <img src="/img/log.png" width="800px"</img> 
</div>

