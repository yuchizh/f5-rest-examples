const axios = require('axios')
const BasicPoolConfigProcessor = require('../nodejs/basicPoolConfigProcessor')

const Q = require('q')
const NACOS_HOST = '127.0.0.1:8848' // replace to real nacos serverList

const PAGE_SIZE = 1000

const nacosServer = axios.create({
  baseURL: `http://${NACOS_HOST}/nacos/v1/ns`,
  timeout: 1000,
})

let nacosServiceNames = []

const basicPoolConfigProcessor = new BasicPoolConfigProcessor()

/**
 * get all service name
 * @returns string[]
 */
function getAllServiceName() {
  return nacosServer.get(`/service/list/?pageNo=${1}&pageSize=${PAGE_SIZE}`)
    .then(function (data) {
      nacosServiceNames = data.data.doms
      return Q(data.data.doms)
    }).catch(() => {
      return Q([])
    })
}

/**
 * get serviceInfo by service name
 * @param {*} serviceName string
 * @returns {Array} { ip: string, port: number }
 */
function getServiceInfo(serviceName) {
  if (!serviceName) return Q({})

  return nacosServer.get(`/instance/list?serviceName=${serviceName}`)
    .then(function (data) {
      // 每个serviceName只获取其中一个节点的ip和端口
      return Q(data.data.hosts[0])
    }).catch(() => {
      return Q({})
    })
}

const interverMap = {}
let onPostParams = undefined
function diffNacosServiceName(restOperation) {
  onPostParams = restOperation
  if (interverMap['interver']) return

  const interval = setInterval(() => {
    getAllServiceName().then((newNacosServiceNames) => {
      if (!newNacosServiceNames.length) return
      for (const name of newNacosServiceNames) {
        if (!nacosServiceNames.includes(name)) {
          basicPoolConfigProcessor.onPost(onPostParams)
          break
        }
      }
      nacosServiceNames = data
    })
  }, 5 * 1000)
  interverMap['interval'] = interval
}

module.exports = {
  getServiceInfo,
  getAllServiceName,
  diffNacosServiceName,
}